import { closeSearchPanel, openSearchPanel, search, searchPanelOpen } from '@codemirror/search';
import { StateEffect } from '@codemirror/state';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createResizeObserverStub } from './tableEditorFixtures';
import {
    activeCellField,
    clearActiveCellEffect,
    getActiveCell,
    setActiveCellEffect,
} from '../tableState/activeCellState';
import {
    isEffectiveRawMode,
    isSourceModeEnabled,
    sourceModeField,
    toggleSourceModeEffect,
} from '../tableState/sourceMode';
import {
    exitSearchForceSourceModeEffect,
    searchPanelTransitionExtension,
} from '../tableRuntime/searchPanelTransitions';
import { tableDecorationField } from '../tableWidget/tableDecorationField';
import { createMarkdownState } from './testMarkdownState';
import { openSearchPanelInState } from './searchPanelTestUtils';

const TABLE = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
const HEADER_CELL = { tableFrom: 0, section: 'header' as const, row: 0, col: 0 };

const resizeObserver = createResizeObserverStub();
const mountedViews: EditorView[] = [];

beforeAll(() => {
    resizeObserver.install();
});

afterAll(() => {
    vi.unstubAllGlobals();
});

afterEach(() => {
    for (const view of mountedViews) {
        view.destroy();
        view.dom.remove();
    }
    mountedViews.length = 0;
});

function mount(): { view: EditorView; updates: ViewUpdate[] } {
    const updates: ViewUpdate[] = [];
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
        parent,
        state: createMarkdownState(TABLE, [
            search(),
            activeCellField,
            sourceModeField,
            tableDecorationField,
            searchPanelTransitionExtension,
            EditorView.updateListener.of((update) => {
                if (update.transactions.length > 0) {
                    updates.push(update);
                }
            }),
        ]),
    });
    mountedViews.push(view);
    return { view, updates };
}

function flushMicrotasks(): Promise<void> {
    return new Promise((resolve) => {
        queueMicrotask(() => {
            queueMicrotask(resolve);
        });
    });
}

describe('searchPanelTransitionExtension', () => {
    it('enters raw mode and clears the active cell in the transaction that opens search', () => {
        const { view, updates } = mount();
        view.dispatch({ effects: setActiveCellEffect.of(HEADER_CELL) });
        updates.length = 0;

        openSearchPanel(view);

        expect(updates).toHaveLength(1);
        expect(updates[0].transactions).toHaveLength(1);
        const transaction = updates[0].transactions[0];
        expect(searchPanelOpen(transaction.startState)).toBe(false);
        expect(searchPanelOpen(transaction.state)).toBe(true);
        expect(getActiveCell(transaction.startState)).toEqual(HEADER_CELL);
        expect(transaction.effects.some((effect) => effect.is(clearActiveCellEffect))).toBe(true);
        expect(getActiveCell(transaction.state)).toBeNull();
        expect(isEffectiveRawMode(transaction.state)).toBe(true);
        expect(transaction.startState.field(tableDecorationField).decorations.size).toBe(1);
        expect(transaction.state.field(tableDecorationField).decorations.size).toBe(0);
    });

    it('restores widgets and carries the search-exit effect in the transaction that closes search', () => {
        const { view, updates } = mount();
        openSearchPanel(view);
        updates.length = 0;

        expect(closeSearchPanel(view)).toBe(true);

        expect(updates).toHaveLength(1);
        expect(updates[0].transactions).toHaveLength(1);
        const transaction = updates[0].transactions[0];
        expect(searchPanelOpen(transaction.startState)).toBe(true);
        expect(searchPanelOpen(transaction.state)).toBe(false);
        expect(transaction.effects.some((effect) => effect.is(exitSearchForceSourceModeEffect))).toBe(true);
        expect(isEffectiveRawMode(transaction.state)).toBe(false);
        expect(transaction.state.field(tableDecorationField).decorations.size).toBe(1);
    });

    it('does not dispatch a follow-up after search opens or closes', async () => {
        const { view, updates } = mount();

        openSearchPanel(view);
        const afterOpen = updates.length;
        await flushMicrotasks();
        expect(updates).toHaveLength(afterOpen);

        closeSearchPanel(view);
        const afterClose = updates.length;
        await flushMicrotasks();
        expect(updates).toHaveLength(afterClose);
    });

    it('stays in raw mode when search closes while explicit source mode remains enabled', () => {
        const { view } = mount();
        view.dispatch({ effects: toggleSourceModeEffect.of(true) });
        openSearchPanel(view);
        closeSearchPanel(view);

        expect(searchPanelOpen(view.state)).toBe(false);
        expect(isSourceModeEnabled(view.state)).toBe(true);
        expect(isEffectiveRawMode(view.state)).toBe(true);
        expect(view.state.field(tableDecorationField).decorations.size).toBe(0);
    });

    it('is raw immediately when table extensions are registered while search is already open', () => {
        const searched = openSearchPanelInState(createMarkdownState(TABLE));
        expect(searchPanelOpen(searched)).toBe(true);
        expect(searched.field(tableDecorationField, false)).toBeUndefined();

        const registered = searched.update({
            effects: StateEffect.appendConfig.of([
                searchPanelTransitionExtension,
                sourceModeField,
                activeCellField,
                tableDecorationField,
            ]),
        }).state;

        expect(searchPanelOpen(registered)).toBe(true);
        expect(isEffectiveRawMode(registered)).toBe(true);
        expect(registered.field(tableDecorationField).decorations.size).toBe(0);
    });

    it('adds no lifecycle effects when the search panel does not change', () => {
        const { view, updates } = mount();
        view.dispatch({ effects: setActiveCellEffect.of(HEADER_CELL) });
        updates.length = 0;

        view.dispatch({ selection: { anchor: 1 } });

        expect(updates).toHaveLength(1);
        const transaction = updates[0].transactions[0];
        expect(transaction.effects.some((effect) => effect.is(clearActiveCellEffect))).toBe(false);
        expect(transaction.effects.some((effect) => effect.is(exitSearchForceSourceModeEffect))).toBe(false);
        expect(getActiveCell(transaction.state)).toEqual(HEADER_CELL);
        expect(isEffectiveRawMode(transaction.state)).toBe(false);
    });
});
