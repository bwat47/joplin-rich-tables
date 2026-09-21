import type { EditorState, TransactionSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getResolvedActiveCell, type ResolvedActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import {
    activeCellField,
    clearActiveCellEffect,
    setActiveCellEffect,
    type ActiveCell,
} from '../tableState/activeCellState';
import { MarkdownTable } from '../tableModel/MarkdownTable';
import { runStructuralCommand } from '../tableRuntime/operations/runStructuralCommand';
import { structuralTableEditEffect } from '../tableState/structuralTableEditEffect';
import { triggerOpenCellRequestEffect } from '../tableRuntime/openCellRequest';
import { createActiveCellForTable } from '../tableRuntime/activeCell/activeCellFactory';
import { beginOpenCellRequestEffect } from '../tableRuntime/openCellRequest';
import { tableDecorationField, wasActiveHostInvalidated } from '../tableWidget/tableDecorationField';
import { createMarkdownState } from './testMarkdownState';
import { createResizeObserverStub } from './tableEditorFixtures';
import { parseTableFixture, parseCellRangesFixture } from './testUtils';

describe('runStructuralCommand', () => {
    let currentTableText = '';

    function createView(tableText: string) {
        currentTableText = tableText;
        const dispatch = vi.fn();
        return {
            state: {
                doc: { length: tableText.length },
            },
            dispatch,
            focus: vi.fn(),
        };
    }

    function createCell(tableText: string, row = 0, col = 0) {
        return {
            tableFrom: 0,
            section: 'body' as const,
            row,
            col,
        } satisfies ActiveCell;
    }

    function createResolvedCell(cell: ActiveCell): ResolvedActiveCell {
        const table = MarkdownTable.parse(currentTableText);
        const cellRanges = parseCellRangesFixture(currentTableText);
        if (!table) {
            throw new Error('Expected valid table fixture');
        }

        return {
            activeCell: cell,
            contentFrom: 0,
            contentTo: 0,
            editableFrom: 0,
            editableTo: 0,
            ctx: {
                from: 0,
                to: currentTableText.length,
                text: currentTableText,
                table,
                cellRanges,
            },
        };
    }

    it('replaces the active table host when the edit only changes the active cell', () => {
        // Clearing the only non-empty cell leaves every change inside the active cell's text.
        const tableText = ['| H1 | H2 |', '| --- | --- |', '| a |  |'].join('\n');
        let state: EditorState = createMarkdownState(tableText, [activeCellField, tableDecorationField]).update({
            effects: setActiveCellEffect.of(createCell(tableText, 0, 0)),
        }).state;
        const resolvedCell = getResolvedActiveCell(state);
        if (!resolvedCell) {
            throw new Error('Expected the active cell to resolve');
        }
        const view = {
            get state() {
                return state;
            },
            dispatch: (spec: TransactionSpec) => {
                state = state.update(spec).state;
            },
            focus: vi.fn(),
        };

        const result = runStructuralCommand(view as never, resolvedCell, { type: 'clearRow' });

        expect(result).toBe(true);
        expect(state.doc.toString()).toBe(['| H1 | H2 |', '| --- | --- |', '|  |  |'].join('\n'));
        expect(wasActiveHostInvalidated(state)).toBe(true);
    });

    it.each([
        {
            command: { type: 'insertRowBefore' } as const,
            insertedTableText: ['| H1 | H2 |', '| --- | --- |', '|  |  |', '| a | b |'].join('\n'),
            nextTarget: { section: 'body' as const, row: 0, col: 1 },
        },
        {
            command: { type: 'insertRowAfter' } as const,
            insertedTableText: ['| H1 | H2 |', '| --- | --- |', '| a | b |', '|  |  |'].join('\n'),
            nextTarget: { section: 'body' as const, row: 1, col: 1 },
        },
    ])('dispatches an explicit reopen transaction for $command.type', ({ command, insertedTableText, nextTarget }) => {
        const tableText = ['| H1 | H2 |', '| --- | --- |', '| a | b |'].join('\n');
        const nextActiveCell = createActiveCellForTable({
            tableFrom: 0,
            serialized: parseTableFixture(insertedTableText).serializeWithOffsets(),
            target: nextTarget,
        });
        expect(nextActiveCell).not.toBeNull();
        if (!nextActiveCell) {
            throw new Error('Expected inserted row active cell');
        }
        const view = createView(tableText);
        const cell = createCell(tableText, 0, 1);

        const result = runStructuralCommand(view as never, createResolvedCell(cell), command);

        expect(result).toBe(true);
        expect(view.dispatch).toHaveBeenCalledTimes(1);
        expect(view.focus).toHaveBeenCalledTimes(1);

        const dispatched = view.dispatch.mock.calls[0][0] as {
            changes?: unknown;
            selection?: { anchor: number };
            effects: Array<{ is?: (value: unknown) => boolean; value?: unknown }>;
        };
        expect(dispatched.changes).toEqual({
            from: 0,
            to: tableText.length,
            insert: insertedTableText,
        });
        expect(dispatched.selection).toEqual({ anchor: nextActiveCell.selectionAnchor });

        const effects = dispatched.effects;
        expect(effects.some((effect: { is?: (value: unknown) => boolean }) => effect.is?.(setActiveCellEffect))).toBe(
            true
        );
        expect(
            effects.some((effect: { is?: (value: unknown) => boolean }) => effect.is?.(structuralTableEditEffect))
        ).toBe(true);
        const openRequest = effects.find((effect: { is?: (value: unknown) => boolean }) =>
            effect.is?.(triggerOpenCellRequestEffect)
        );
        const beginRequest = effects.find((effect: { is?: (value: unknown) => boolean }) =>
            effect.is?.(beginOpenCellRequestEffect)
        );
        expect(beginRequest?.value).toMatchObject({
            activeCell: nextTarget,
            suppressKeys: true,
            initialCursorPos: 'start',
        });
        expect(openRequest?.value).toEqual({ requestId: (beginRequest?.value as { requestId?: string })?.requestId });
    });

    it('does not focus the main editor when the structural command is a no-op', () => {
        const tableText = ['| H1 | H2 |', '| --- | --- |', '| a | b |'].join('\n');
        const view = createView(tableText);
        const cell = createCell(tableText, 0, 0);

        const result = runStructuralCommand(view as never, createResolvedCell(cell), { type: 'moveColumnLeft' });

        expect(result).toBe(false);
        expect(view.dispatch).not.toHaveBeenCalled();
        expect(view.focus).not.toHaveBeenCalled();
    });

    it('dispatches reopen effects when markdown is unchanged but target cell moves', () => {
        const tableText = ['| H1 | H2 |', '| --- | --- |', '| a | a |', '| a | a |'].join('\n');
        const view = createView(tableText);
        const cell = createCell(tableText, 1, 0);

        const result = runStructuralCommand(view as never, createResolvedCell(cell), { type: 'moveRowUp' });

        expect(result).toBe(true);
        expect(view.dispatch).toHaveBeenCalledTimes(1);

        const dispatched = view.dispatch.mock.calls[0][0] as {
            changes?: unknown;
            selection?: { anchor: number };
            effects: Array<{ is?: (value: unknown) => boolean; value?: unknown }>;
        };
        expect(dispatched.changes).toBeUndefined();
        expect(dispatched.selection).toEqual(expect.objectContaining({ anchor: expect.any(Number) }));

        const effects = dispatched.effects;
        expect(effects.some((effect) => effect.is?.(setActiveCellEffect))).toBe(true);
        expect(effects.some((effect) => effect.is?.(triggerOpenCellRequestEffect))).toBe(true);
        expect(effects.some((effect) => effect.is?.(structuralTableEditEffect))).toBe(true);
    });

    it('dispatches explicit reopen effects for non-row structural mutations too', () => {
        const tableText = ['| H1 | H2 |', '| --- | --- |', '| a | b |'].join('\n');
        const updatedTableText = ['| H1 | H2 |', '| :---: | --- |', '| a | b |'].join('\n');
        const nextActiveCell = createActiveCellForTable({
            tableFrom: 0,
            serialized: parseTableFixture(updatedTableText).serializeWithOffsets(),
            target: { section: 'body', row: 0, col: 0 },
        });
        expect(nextActiveCell).not.toBeNull();
        if (!nextActiveCell) {
            throw new Error('Expected aligned active cell');
        }

        const view = createView(tableText);
        const cell = createCell(tableText, 0, 0);

        const result = runStructuralCommand(view as never, createResolvedCell(cell), {
            type: 'alignColumn',
            alignment: 'center',
        });

        expect(result).toBe(true);
        expect(view.dispatch).toHaveBeenCalledTimes(1);

        const dispatched = view.dispatch.mock.calls[0][0] as {
            changes?: { insert: string };
            effects: Array<{ is?: (value: unknown) => boolean; value?: unknown }>;
        };
        expect(dispatched.changes?.insert).toBe(updatedTableText);
        expect(dispatched.effects.some((effect) => effect.is?.(triggerOpenCellRequestEffect))).toBe(true);
        expect(dispatched.effects.some((effect) => effect.is?.(structuralTableEditEffect))).toBe(true);
        const beginRequest = dispatched.effects.find((effect) => effect.is?.(beginOpenCellRequestEffect));
        expect(beginRequest?.value).toMatchObject({ suppressKeys: true });
        expect(beginRequest?.value).toHaveProperty('initialCursorPos', undefined);
    });

    it.each([
        ['deleteTable', '| H1 | H2 |\n| --- | --- |\n| a | b |', { section: 'body', row: 0, col: 0 }],
        ['deleteRow', '| H1 | H2 |\n| --- | --- |', { section: 'header', row: 0, col: 0 }],
        ['deleteColumn', '| H1 |\n| --- |\n| a |', { section: 'body', row: 0, col: 0 }],
    ] as const)('dispatches table deletion for %s without reopen effects', (commandType, tableText, activeCell) => {
        const view = createView(tableText);

        const result = runStructuralCommand(
            view as never,
            createResolvedCell({
                tableFrom: 0,
                ...activeCell,
            }),
            { type: commandType }
        );

        expect(result).toBe(true);
        expect(view.dispatch).toHaveBeenCalledTimes(1);
        expect(view.focus).toHaveBeenCalledTimes(1);

        const dispatched = view.dispatch.mock.calls[0][0] as {
            changes?: unknown;
            selection?: unknown;
            effects: Array<{ is?: (value: unknown) => boolean }>;
        };
        expect(dispatched.changes).toEqual({
            from: 0,
            to: tableText.length,
            insert: '',
        });
        expect(dispatched.selection).toBeUndefined();
        expect(dispatched.effects.some((effect) => effect.is?.(clearActiveCellEffect))).toBe(true);
        expect(dispatched.effects.some((effect) => effect.is?.(structuralTableEditEffect))).toBe(true);
        expect(dispatched.effects.some((effect) => effect.is?.(triggerOpenCellRequestEffect))).toBe(false);
        expect(dispatched.effects.some((effect) => effect.is?.(beginOpenCellRequestEffect))).toBe(false);
    });

    describe('main editor focus after structural dispatch', () => {
        let view: EditorView | undefined;
        const resizeObserver = createResizeObserverStub();

        beforeEach(() => {
            resizeObserver.install();
        });

        afterEach(() => {
            vi.unstubAllGlobals();
            if (!view) {
                return;
            }
            const parent = view.dom.parentElement;
            view.destroy();
            parent?.remove();
            view = undefined;
        });

        it('hands focus back to the main editor after a structural dispatch', () => {
            const tableText = ['| H1 | H2 |', '| --- | --- |', '| a | b |'].join('\n');
            const state = createMarkdownState(tableText, [activeCellField, tableDecorationField]).update({
                effects: setActiveCellEffect.of(createCell(tableText, 0, 0)),
            }).state;
            const parent = document.createElement('div');
            document.body.appendChild(parent);
            view = new EditorView({ state, parent });
            view.contentDOM.blur();
            expect(document.activeElement).not.toBe(view.contentDOM);

            const resolvedCell = getResolvedActiveCell(view.state);
            if (!resolvedCell) {
                throw new Error('Expected the active cell to resolve');
            }

            runStructuralCommand(view, resolvedCell, { type: 'clearRow' });

            expect(document.activeElement).toBe(view.contentDOM);
        });
    });
});
