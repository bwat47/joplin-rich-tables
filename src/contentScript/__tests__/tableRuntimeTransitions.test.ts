import { describe, expect, it } from '@jest/globals';
import { EditorState, Transaction } from '@codemirror/state';
import {
    activeCellField,
    clearActiveCellEffect,
    setActiveCellEffect,
    type ActiveCell,
} from '../tableState/activeCellState';
import { resolveCurrentActiveCell } from '../tableRuntime/activeCellResolver';
import { rebuildTableWidgetsEffect } from '../tableState/tableWidgetEffects';
import { sourceModeField, toggleSourceModeEffect } from '../tableState/sourceMode';
import { searchForceSourceModeField } from '../tableState/searchForceSourceMode';
import {
    buildTableRuntimeEvent,
    decideMainEditorGuardTransaction,
    decideTableDecorationUpdate,
    planTableLifecycleActions,
    type TableRuntimeEvent,
    type TableRuntimeSnapshot,
} from '../tableRuntime/tableRuntimeTransitions';
import { syncAnnotation } from '../nestedEditor/nestedCellEditor';
import { createMarkdownState } from './testMarkdownState';
import { normalizeBeforeEditAnnotation } from '../tableRuntime/tableNormalization';
import { createActiveCellForTableText } from '../tableRuntime/activeCellFactory';

const doc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');

function createState(params?: { activeCell?: ActiveCell | null }) {
    let state = createMarkdownState(doc, [activeCellField, sourceModeField, searchForceSourceModeField]);

    if (params?.activeCell) {
        state = state.update({ effects: setActiveCellEffect.of(params.activeCell) }).state;
    }

    return state;
}

function getHeaderCell(): ActiveCell {
    return {
        anchorPos: doc.indexOf('H1'),
        tableFrom: 0,
        section: 'header',
        row: 0,
        col: 0,
    };
}

function requireResolvedActiveCell(state: EditorState) {
    const resolved = resolveCurrentActiveCell(state);
    if (!resolved) {
        throw new Error('Expected resolved active cell');
    }
    return resolved;
}

function createViewUpdate(
    startState: EditorState,
    spec: Parameters<EditorState['update']>[0]
): { state: EditorState; event: TableRuntimeEvent; update: TableRuntimeEvent['update'] } {
    const tr = startState.update(spec);
    const update = {
        startState,
        state: tr.state,
        transactions: [tr],
        docChanged: tr.docChanged,
        selectionSet: tr.selection !== startState.selection,
    } as unknown as TableRuntimeEvent['update'];

    return {
        state: tr.state,
        update,
        event: buildTableRuntimeEvent(update, false),
    };
}

describe('tableRuntimeTransitions', () => {
    it('maps decorations for in-cell edits while active', () => {
        const activeCell = getHeaderCell();
        const state = createState({ activeCell });
        const resolved = requireResolvedActiveCell(state);
        const tr = state.update({
            changes: { from: resolved.cellFrom, to: resolved.cellFrom, insert: 'x' },
        });

        expect(decideTableDecorationUpdate(tr)).toEqual({ type: 'mapDecorations' });
    });

    it('rebuilds decorations for undo structural edits while active', () => {
        const activeCell = getHeaderCell();
        const state = createState({ activeCell });
        const tr = state.update({
            changes: { from: doc.length, to: doc.length, insert: '\n| b1 | b2 |' },
            annotations: Transaction.userEvent.of('undo'),
        });

        expect(decideTableDecorationUpdate(tr)).toEqual({ type: 'rebuildAllDecorations' });
    });

    it('rebuilds all decorations when active cell is cleared', () => {
        const activeCell = getHeaderCell();
        const state = createState({ activeCell });
        const tr = state.update({ effects: clearActiveCellEffect.of(undefined) });

        expect(decideTableDecorationUpdate(tr)).toEqual({ type: 'rebuildAllDecorations' });
    });

    it('returns none decorations in raw mode', () => {
        const state = createState();
        const tr = state.update({ effects: toggleSourceModeEffect.of(true) });

        expect(decideTableDecorationUpdate(tr)).toEqual({ type: 'noneDecorations' });
    });

    it('suppresses immediate rebuild on full document replace with active cell', () => {
        const activeCell = getHeaderCell();
        const state = createState({ activeCell });
        const tr = state.update({
            changes: { from: 0, to: doc.length, insert: '# replaced' },
        });

        expect(decideTableDecorationUpdate(tr)).toEqual({ type: 'noneDecorations' });
    });

    it('allows sync transactions through the guard untouched', () => {
        const activeCell = getHeaderCell();
        const state = createState({ activeCell });
        const resolved = requireResolvedActiveCell(state);
        const tr = state.update({
            changes: { from: resolved.cellFrom, to: resolved.cellFrom, insert: 'x' },
            annotations: syncAnnotation.of(true),
        });

        expect(decideMainEditorGuardTransaction(tr, { nestedEditorOpen: true })).toEqual({
            type: 'allowTransaction',
        });
    });

    it('rejects guard changes touching the active table outside the cell', () => {
        const activeCell = getHeaderCell();
        const state = createState({ activeCell });
        const tr = state.update({
            changes: { from: 0, to: 1, insert: '' },
        });

        expect(decideMainEditorGuardTransaction(tr, { nestedEditorOpen: true })).toEqual({
            type: 'rejectTransaction',
        });
    });

    it('sanitizes guard changes inside the active cell', () => {
        const activeCell = getHeaderCell();
        let state = createState({ activeCell });
        const resolved = requireResolvedActiveCell(state);
        state = state.update({
            selection: { anchor: resolved.cellFrom, head: resolved.cellFrom },
        }).state;
        const tr = state.update({
            changes: { from: resolved.cellFrom, to: resolved.cellFrom, insert: 'a\nb|c' },
        });

        const decision = decideMainEditorGuardTransaction(tr, { nestedEditorOpen: true });
        expect(decision.type).toBe('sanitizeTransactionChanges');
        if (decision.type !== 'sanitizeTransactionChanges') {
            throw new Error('Expected sanitize decision');
        }

        expect(decision.selection.main.head).toBe(resolved.cellFrom + 'a<br>b\\|c'.length);
    });

    it('plans raw mode exit as cursor reactivation', () => {
        const activeCell = getHeaderCell();
        const snapshot: TableRuntimeSnapshot = {
            activeCell,
            prevActiveCell: activeCell,
            resolvedActiveCell: null,
            resolvedPrevActiveCell: null,
            effectiveRawMode: false,
            nestedEditorOpen: false,
            hadActiveCell: true,
            pendingFullReplaceRebuild: false,
        };
        const event = {
            update: {} as TableRuntimeEvent['update'],
            isSync: false,
            isNormalizeBeforeEdit: false,
            isCellSelectionTransition: false,
            forceRebuild: false,
            rawModeEffects: {
                exitedSourceMode: true,
                exitedSearchForce: false,
                hadRawModeToggle: true,
            },
            enteredRawMode: false,
            exitedRawMode: true,
            hasFullDocumentReplace: false,
        } satisfies TableRuntimeEvent;

        expect(planTableLifecycleActions(snapshot, event, { cursorInsideTableAfterUndoRedo: false })).toEqual([
            {
                type: 'scheduleActivateCellAtCursor',
                clearIfOutside: false,
                ensureCursorVisibleIfNotActivated: true,
                normalizeIfNeeded: false,
            },
        ]);
    });

    it('treats normalize-before-edit full table replacement as a controlled reopen', () => {
        const nonCanonicalDoc = ['|H1|H2|', '|---|---|', '|a1|a2|'].join('\n');
        let startState = createMarkdownState(nonCanonicalDoc, [
            activeCellField,
            sourceModeField,
            searchForceSourceModeField,
        ]);
        const startActiveCell: ActiveCell = {
            anchorPos: nonCanonicalDoc.indexOf('H1'),
            tableFrom: 0,
            section: 'header',
            row: 0,
            col: 0,
        };
        startState = startState.update({ effects: setActiveCellEffect.of(startActiveCell) }).state;

        const canonicalDoc = doc;
        const nextActiveCell = createActiveCellForTableText({
            tableFrom: 0,
            tableText: canonicalDoc,
            target: startActiveCell,
        });
        expect(nextActiveCell).not.toBeNull();
        if (!nextActiveCell) {
            throw new Error('Expected normalized active cell');
        }

        const tr = startState.update({
            changes: { from: 0, to: nonCanonicalDoc.length, insert: canonicalDoc },
            selection: { anchor: nextActiveCell.anchorPos },
            effects: [setActiveCellEffect.of(nextActiveCell), rebuildTableWidgetsEffect.of({ tableFrom: 0 })],
            annotations: normalizeBeforeEditAnnotation.of(true),
        });
        const update = {
            startState,
            state: tr.state,
            transactions: [tr],
            docChanged: tr.docChanged,
            selectionSet: tr.selection !== startState.selection,
        } as unknown as TableRuntimeEvent['update'];
        const snapshot: TableRuntimeSnapshot = {
            activeCell: nextActiveCell,
            prevActiveCell: startActiveCell,
            resolvedActiveCell: requireResolvedActiveCell(tr.state),
            resolvedPrevActiveCell: requireResolvedActiveCell(startState),
            effectiveRawMode: false,
            nestedEditorOpen: false,
            hadActiveCell: true,
            pendingFullReplaceRebuild: false,
        };

        expect(decideTableDecorationUpdate(tr)).toEqual({ type: 'rebuildAllDecorations' });
        expect(decideMainEditorGuardTransaction(tr, { nestedEditorOpen: true })).toEqual({
            type: 'allowTransaction',
        });
        expect(
            planTableLifecycleActions(snapshot, buildTableRuntimeEvent(update, false), {
                cursorInsideTableAfterUndoRedo: false,
            })
        ).toEqual([{ type: 'openNestedEditor', activeCell: nextActiveCell }]);
    });

    it('plans force rebuild as close and reopen of the nested editor', () => {
        const activeCell = getHeaderCell();
        const startState = createState({ activeCell });
        const { event } = createViewUpdate(startState, {
            effects: rebuildTableWidgetsEffect.of({ tableFrom: activeCell.tableFrom }),
        });
        const snapshot: TableRuntimeSnapshot = {
            activeCell,
            prevActiveCell: activeCell,
            resolvedActiveCell: requireResolvedActiveCell(createState({ activeCell })),
            resolvedPrevActiveCell: requireResolvedActiveCell(createState({ activeCell })),
            effectiveRawMode: false,
            nestedEditorOpen: true,
            hadActiveCell: true,
            pendingFullReplaceRebuild: false,
        };

        expect(planTableLifecycleActions(snapshot, event, { cursorInsideTableAfterUndoRedo: false })).toEqual([
            { type: 'closeNestedEditor' },
            { type: 'openNestedEditor', activeCell },
        ]);
    });

    it('plans stale active cell cleanup when the nested editor is gone', () => {
        const activeCell = getHeaderCell();
        const startState = createState({ activeCell });
        const resolved = requireResolvedActiveCell(startState);
        const { event } = createViewUpdate(startState, {
            changes: { from: resolved.cellFrom, to: resolved.cellFrom, insert: 'x' },
        });
        const snapshot: TableRuntimeSnapshot = {
            activeCell,
            prevActiveCell: activeCell,
            resolvedActiveCell: requireResolvedActiveCell(event.update.state),
            resolvedPrevActiveCell: resolved,
            effectiveRawMode: false,
            nestedEditorOpen: false,
            hadActiveCell: true,
            pendingFullReplaceRebuild: false,
        };

        expect(planTableLifecycleActions(snapshot, event, { cursorInsideTableAfterUndoRedo: false })).toContainEqual({
            type: 'clearActiveCell',
        });
    });

    it('clears stale active cell when the resolver cannot find the table', () => {
        const activeCell = getHeaderCell();
        const state = createState({ activeCell });
        const tr = state.update({
            changes: { from: 0, to: doc.length, insert: '# replaced' },
            annotations: Transaction.userEvent.of('input'),
        });
        const snapshot: TableRuntimeSnapshot = {
            activeCell: getHeaderCell(),
            prevActiveCell: getHeaderCell(),
            resolvedActiveCell: null,
            resolvedPrevActiveCell: requireResolvedActiveCell(state),
            effectiveRawMode: false,
            nestedEditorOpen: false,
            hadActiveCell: true,
            pendingFullReplaceRebuild: false,
        };
        const update = {
            startState: state,
            state: tr.state,
            transactions: [tr],
            docChanged: tr.docChanged,
            selectionSet: tr.selection !== state.selection,
        } as unknown as TableRuntimeEvent['update'];

        expect(
            planTableLifecycleActions(snapshot, buildTableRuntimeEvent(update, false), {
                cursorInsideTableAfterUndoRedo: false,
            })
        ).toContainEqual({
            type: 'clearActiveCell',
        });
    });
});
