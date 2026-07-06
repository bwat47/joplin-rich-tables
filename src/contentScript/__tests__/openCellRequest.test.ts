/**
 * @vitest-environment jsdom
 */

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { vi, type Mock } from 'vitest';
import { activeCellField, type ActiveCell } from '../tableState/activeCellState';
import {
    beginOpenCellRequestEffect,
    clearOpenCellRequestEffect,
    getPendingOpenCellRequest,
    openCellRequestField,
    openCellRequestTimeoutPlugin,
    shouldSuppressNavigationKeys,
} from '../tableRuntime/openCellRequest';

vi.mock('../../logger', () => ({
    logger: {
        warn: vi.fn(),
    },
}));

import { logger } from '../../logger';
const mockLoggerWarn = logger.warn as Mock;

describe('openCellRequestField', () => {
    const activeCell: ActiveCell = {
        tableFrom: 0,
        section: 'header',
        row: 0,
        col: 0,
    };

    const createState = () =>
        EditorState.create({
            doc: '| H1 |\n| --- |\n| a |',
            extensions: [activeCellField, openCellRequestField],
        });

    const beginRequest = (state: EditorState, params?: { requestId?: string; suppressKeys?: boolean }) =>
        state.update({
            effects: beginOpenCellRequestEffect.of({
                requestId: params?.requestId ?? 'request-1',
                activeCell,
                normalizeIfNeeded: true,
                suppressKeys: params?.suppressKeys ?? true,
            }),
        }).state;

    it('stores a pending request', () => {
        const state = beginRequest(createState());

        expect(getPendingOpenCellRequest(state)).toMatchObject({
            requestId: 'request-1',
            activeCell,
            normalizeIfNeeded: true,
        });
    });

    it('clears only the matching request', () => {
        const state = beginRequest(createState());

        const staleClear = state.update({
            effects: clearOpenCellRequestEffect.of({ requestId: 'stale' }),
        }).state;
        expect(getPendingOpenCellRequest(staleClear)?.requestId).toBe('request-1');

        const cleared = staleClear.update({
            effects: clearOpenCellRequestEffect.of({ requestId: 'request-1' }),
        }).state;
        expect(getPendingOpenCellRequest(cleared)).toBeNull();
    });

    it('does not let stale clear remove a newer request', () => {
        const first = beginRequest(createState(), { requestId: 'request-1' });
        const second = beginRequest(first, { requestId: 'request-2' });

        const cleared = second.update({
            effects: clearOpenCellRequestEffect.of({ requestId: 'request-1' }),
        }).state;

        expect(getPendingOpenCellRequest(cleared)?.requestId).toBe('request-2');
    });

    it('maps active cell table start through document changes', () => {
        const state = beginRequest(createState());

        const mapped = state.update({
            changes: { from: 0, to: 0, insert: 'prefix\n' },
        }).state;

        expect(getPendingOpenCellRequest(mapped)?.activeCell.tableFrom).toBe('prefix\n'.length);
    });

    it('clears the request when the table start is deleted', () => {
        const state = beginRequest(createState());

        const mapped = state.update({
            changes: { from: 0, to: 1, insert: '' },
        }).state;

        expect(getPendingOpenCellRequest(mapped)).toBeNull();
    });

    it('uses suppressKeys for navigation-key suppression', () => {
        const suppressing = beginRequest(createState(), { suppressKeys: true });
        const notSuppressing = beginRequest(createState(), { suppressKeys: false });

        expect(shouldSuppressNavigationKeys(suppressing)).toBe(true);
        expect(shouldSuppressNavigationKeys(notSuppressing)).toBe(false);
        expect(shouldSuppressNavigationKeys(createState())).toBe(false);
    });

    it('fails a stuck request after the watchdog timeout', () => {
        vi.useFakeTimers();
        mockLoggerWarn.mockClear();

        const parent = document.createElement('div');
        document.body.appendChild(parent);
        const view = new EditorView({
            parent,
            state: EditorState.create({
                doc: '| H1 |\n| --- |\n| a |',
                extensions: [activeCellField, openCellRequestField, openCellRequestTimeoutPlugin],
            }),
        });

        view.dispatch({
            effects: beginOpenCellRequestEffect.of({
                requestId: 'request-timeout',
                activeCell,
                normalizeIfNeeded: true,
                suppressKeys: true,
            }),
        });

        vi.advanceTimersByTime(1000);

        expect(getPendingOpenCellRequest(view.state)).toBeNull();
        expect(mockLoggerWarn).toHaveBeenCalledWith('Open-cell request timed out - forcing release');

        view.destroy();
        vi.useRealTimers();
    });
});
