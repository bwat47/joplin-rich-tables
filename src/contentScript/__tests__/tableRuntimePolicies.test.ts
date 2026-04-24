import { describe, expect, it } from '@jest/globals';
import { EditorState, Transaction, type TransactionSpec } from '@codemirror/state';
import {
    activeCellField,
    clearActiveCellEffect,
    getActiveCell,
    setActiveCellEffect,
    type ActiveCell,
} from '../tableState/activeCellState';
import { cellSelectionField, setCellSelectionEffect } from '../tableState/cellSelectionState';
import { resolveActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import { rebuildTableWidgetsEffect } from '../tableState/tableWidgetEffects';
import { sourceModeField, toggleSourceModeEffect } from '../tableState/sourceMode';
import { searchForceSourceModeField, setSearchForceSourceModeEffect } from '../tableState/searchForceSourceMode';
import {
    buildTableRuntimeEvent,
    planTableLifecycleActions,
    type TableRuntimeEvent,
    type TableRuntimeSnapshot,
} from '../tableRuntime/lifecycle/lifecyclePolicy';
import { transactionRequiresTableRebuild } from '../tableRuntime/tableTransactionHelpers';
import { decideMainEditorGuardTransaction } from '../editorBridge/mainEditorGuardPolicy';
import { decideTableDecorationUpdate } from '../tableWidget/tableDecorationPolicy';
import { syncAnnotation } from '../editorBridge/syncAnnotation';
import { createMarkdownState } from './testMarkdownState';
import { normalizeBeforeEditAnnotation } from '../tableRuntime/lifecycle/tableNormalization';
import { createActiveCellForTableText } from '../tableRuntime/activeCell/activeCellFactory';
import { requestOpenCellEffect } from '../tableRuntime/openCellRequest';

const doc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');

function createState(params?: { activeCell?: ActiveCell | null }) {
    let state = createMarkdownState(doc, [
        activeCellField,
        cellSelectionField,
        sourceModeField,
        searchForceSourceModeField,
    ]);

    if (params?.activeCell) {
        state = state.update({ effects: setActiveCellEffect.of(params.activeCell) }).state;
    }

    return state;
}

function getHeaderCell(): ActiveCell {
    return {
        tableFrom: 0,
        section: 'header',
        row: 0,
        col: 0,
    };
}

function requireResolvedActiveCell(state: EditorState) {
    const resolved = resolveActiveCell(state, getActiveCell(state));
    if (!resolved) {
        throw new Error('Expected resolved active cell');
    }
    return resolved;
}

function createViewUpdate(
    startState: EditorState,
    spec: TransactionSpec
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

describe('tableRuntimePolicies', () => {
    it('maps decorations for in-cell edits while active', () => {
        const activeCell = getHeaderCell();
        const state = createState({ activeCell });
        const resolved = requireResolvedActiveCell(state);
        const tr = state.update({
            changes: { from: resolved.editableFrom, to: resolved.editableFrom, insert: 'x' },
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
            changes: { from: resolved.editableFrom, to: resolved.editableFrom, insert: 'x' },
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

    it('allows guard changes inside editable edge whitespace', () => {
        const paddedDoc = ['| H1  | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
        let state = createMarkdownState(paddedDoc, [
            activeCellField,
            cellSelectionField,
            sourceModeField,
            searchForceSourceModeField,
        ]);
        state = state.update({ effects: setActiveCellEffect.of(getHeaderCell()) }).state;
        const resolved = requireResolvedActiveCell(state);

        const tr = state.update({
            changes: { from: resolved.editableTo, to: resolved.editableTo, insert: ' ' },
        });

        expect(decideMainEditorGuardTransaction(tr, { nestedEditorOpen: true })).toEqual({
            type: 'allowTransaction',
        });
    });

    it('returns a clipboard rewrite decision for markdown-table paste while nested editor is open', () => {
        const activeCell = getHeaderCell();
        let state = createState({ activeCell });
        const resolved = requireResolvedActiveCell(state);
        state = state.update({
            selection: { anchor: resolved.editableFrom, head: resolved.editableFrom },
        }).state;

        const tr = state.update({
            changes: {
                from: resolved.editableFrom,
                to: resolved.editableFrom,
                insert: ['| P1 | P2 |', '| :--- | ---: |', '| Q1 | Q2 |'].join('\n'),
            },
            userEvent: 'input.paste',
        });

        const decision = decideMainEditorGuardTransaction(tr, { nestedEditorOpen: true });

        expect(decision.type).toBe('rewriteTableClipboard');
        if (decision.type !== 'rewriteTableClipboard') {
            throw new Error('Expected clipboard rewrite decision');
        }

        expect(decision.rewrite.tableText).toBe(['| P1 | P2 |', '| --- | --- |', '| Q1 | Q2 |'].join('\n'));
    });

    it('returns a root-table rewrite decision for standalone table paste at a block boundary', () => {
        const state = createMarkdownState(['before', '', 'after'].join('\n'), [
            activeCellField,
            cellSelectionField,
            sourceModeField,
            searchForceSourceModeField,
        ]);
        const pasteText = ['|H1|H2|', '|---|---|', '|a|b|'].join('\n');
        const pastePos = 'before\n'.length;

        const tr = state.update({
            changes: { from: pastePos, to: pastePos, insert: pasteText },
            userEvent: 'input.paste',
        });

        const decision = decideMainEditorGuardTransaction(tr, { nestedEditorOpen: false });

        expect(decision.type).toBe('rewriteRootTablePaste');
        if (decision.type !== 'rewriteRootTablePaste') {
            throw new Error('Expected root paste rewrite decision');
        }

        expect(decision.rewrite.changes.insert).toBe(['', '| H1 | H2 |', '| --- | --- |', '| a | b |', ''].join('\n'));
        expect(decision.rewrite.tableFrom).toBe(8);
    });

    it('does not return a root-table rewrite when a cell selection is active', () => {
        let state = createMarkdownState(['before', '', 'after'].join('\n'), [
            activeCellField,
            cellSelectionField,
            sourceModeField,
            searchForceSourceModeField,
        ]);
        state = state.update({
            effects: setCellSelectionEffect.of({
                tableFrom: 0,
                anchor: { section: 'header', row: 0, col: 0 },
                focus: { section: 'body', row: 0, col: 0 },
            }),
        }).state;
        const pasteText = ['|H1|H2|', '|---|---|', '|a|b|'].join('\n');

        const tr = state.update({
            changes: { from: 0, to: 0, insert: pasteText },
            userEvent: 'input.paste',
        });

        expect(decideMainEditorGuardTransaction(tr, { nestedEditorOpen: false })).toEqual({
            type: 'allowTransaction',
        });
    });

    it('does not return a root-table rewrite when search is forcing raw mode', () => {
        let state = createMarkdownState(['before', '', 'after'].join('\n'), [
            activeCellField,
            cellSelectionField,
            sourceModeField,
            searchForceSourceModeField,
        ]);
        state = state.update({ effects: setSearchForceSourceModeEffect.of(true) }).state;
        const pasteText = ['|H1|H2|', '|---|---|', '|a|b|'].join('\n');
        const pastePos = 'before\n'.length;

        const tr = state.update({
            changes: { from: pastePos, to: pastePos, insert: pasteText },
            userEvent: 'input.paste',
        });

        expect(decideMainEditorGuardTransaction(tr, { nestedEditorOpen: false })).toEqual({
            type: 'allowTransaction',
        });
    });

    it('sanitizes guard changes inside the active cell', () => {
        const activeCell = getHeaderCell();
        let state = createState({ activeCell });
        const resolved = requireResolvedActiveCell(state);
        state = state.update({
            selection: { anchor: resolved.editableFrom, head: resolved.editableFrom },
        }).state;
        const tr = state.update({
            changes: { from: resolved.editableFrom, to: resolved.editableFrom, insert: 'a\nb|c' },
        });

        const decision = decideMainEditorGuardTransaction(tr, { nestedEditorOpen: true });
        expect(decision.type).toBe('sanitizeTransactionChanges');
        if (decision.type !== 'sanitizeTransactionChanges') {
            throw new Error('Expected sanitize decision');
        }

        expect(decision.selection.main.head).toBe(resolved.editableFrom + 'a<br>b\\|c'.length);
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
            openRequestId: null,
        } satisfies TableRuntimeEvent;

        expect(planTableLifecycleActions(snapshot, event, { cursorInsideTableAfterUndoRedo: false })).toEqual([
            {
                type: 'scheduleActivateCellAtCursor',
                clearIfOutside: false,
                ensureCursorVisibleIfNotActivated: true,
                normalizeIfNeeded: false,
                preserveMainSelection: true,
            },
        ]);
    });

    it('treats normalize-before-edit full table replacement as a controlled requested reopen', () => {
        const nonCanonicalDoc = ['|H1|H2|', '|---|---|', '|a1|a2|'].join('\n');
        let startState = createMarkdownState(nonCanonicalDoc, [
            activeCellField,
            sourceModeField,
            searchForceSourceModeField,
        ]);
        const startActiveCell: ActiveCell = {
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
            selection: { anchor: nextActiveCell.selectionAnchor },
            effects: [
                setActiveCellEffect.of(nextActiveCell.activeCell),
                rebuildTableWidgetsEffect.of({ tableFrom: 0 }),
                requestOpenCellEffect.of({
                    requestId: 'normalize-request',
                }),
            ],
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
            activeCell: nextActiveCell.activeCell,
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
        ).toEqual([{ type: 'openRequestedCell', requestId: 'normalize-request' }]);
    });

    it('does not plan a generic reopen for rebuild-only transactions', () => {
        const activeCell = getHeaderCell();
        const startState = createState({ activeCell });
        const tr = startState.update({
            effects: rebuildTableWidgetsEffect.of({ tableFrom: activeCell.tableFrom }),
        });
        const update = {
            startState,
            state: tr.state,
            transactions: [tr],
            docChanged: tr.docChanged,
            selectionSet: false,
        } as unknown as TableRuntimeEvent['update'];
        const event = buildTableRuntimeEvent(update, false);
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

        expect(planTableLifecycleActions(snapshot, event, { cursorInsideTableAfterUndoRedo: false })).toEqual([]);
    });

    it('prefers an explicit open request over the generic force-rebuild branch', () => {
        const activeCell = getHeaderCell();
        const startState = createState({ activeCell });
        const { event } = createViewUpdate(startState, {
            effects: [
                requestOpenCellEffect.of({
                    requestId: 'explicit-request',
                }),
                rebuildTableWidgetsEffect.of({ tableFrom: activeCell.tableFrom }),
            ],
        });
        const snapshot: TableRuntimeSnapshot = {
            activeCell,
            prevActiveCell: activeCell,
            resolvedActiveCell: requireResolvedActiveCell(startState),
            resolvedPrevActiveCell: requireResolvedActiveCell(startState),
            effectiveRawMode: false,
            nestedEditorOpen: true,
            hadActiveCell: true,
            pendingFullReplaceRebuild: false,
        };

        expect(planTableLifecycleActions(snapshot, event, { cursorInsideTableAfterUndoRedo: false })).toEqual([
            { type: 'openRequestedCell', requestId: 'explicit-request' },
        ]);
    });

    it('uses the latest open request when an update contains multiple open signals', () => {
        const activeCell = getHeaderCell();
        const startState = createState({ activeCell });
        const { event } = createViewUpdate(startState, {
            effects: [
                requestOpenCellEffect.of({
                    requestId: 'stale-request',
                }),
                requestOpenCellEffect.of({
                    requestId: 'latest-request',
                }),
            ],
        });
        const snapshot: TableRuntimeSnapshot = {
            activeCell,
            prevActiveCell: activeCell,
            resolvedActiveCell: requireResolvedActiveCell(startState),
            resolvedPrevActiveCell: requireResolvedActiveCell(startState),
            effectiveRawMode: false,
            nestedEditorOpen: true,
            hadActiveCell: true,
            pendingFullReplaceRebuild: false,
        };

        expect(event.openRequestId).toBe('latest-request');
        expect(planTableLifecycleActions(snapshot, event, { cursorInsideTableAfterUndoRedo: false })).toEqual([
            { type: 'openRequestedCell', requestId: 'latest-request' },
        ]);
    });

    it('uses the resolved update range when undo or redo repositions the active cell', () => {
        const activeCell = getHeaderCell();
        const startState = createState({ activeCell });
        const { event } = createViewUpdate(startState, {
            changes: { from: 0, to: 0, insert: 'abc\n' },
            annotations: Transaction.userEvent.of('redo'),
        });
        const snapshot: TableRuntimeSnapshot = {
            activeCell: getActiveCell(event.update.state),
            prevActiveCell: activeCell,
            resolvedActiveCell: resolveActiveCell(event.update.state, getActiveCell(event.update.state)),
            resolvedPrevActiveCell: requireResolvedActiveCell(startState),
            effectiveRawMode: false,
            nestedEditorOpen: true,
            hadActiveCell: true,
            pendingFullReplaceRebuild: false,
        };

        expect(planTableLifecycleActions(snapshot, event, { cursorInsideTableAfterUndoRedo: true })).toEqual([
            { type: 'closeNestedEditor', useResolvedRangeFromUpdate: true },
            {
                type: 'scheduleActivateCellAtCursor',
                clearIfOutside: true,
                ensureCursorVisibleIfNotActivated: false,
                normalizeIfNeeded: false,
                preserveMainSelection: false,
            },
        ]);
    });

    it('closes and clears the active cell when selection moves outside the active table', () => {
        const prefixedDoc = ['before', '', doc, '', 'after'].join('\n');
        const tableFrom = 'before\n\n'.length;
        const activeCell: ActiveCell = {
            tableFrom,
            section: 'header',
            row: 0,
            col: 0,
        };
        let startState = createMarkdownState(prefixedDoc, [
            activeCellField,
            cellSelectionField,
            sourceModeField,
            searchForceSourceModeField,
        ]);
        startState = startState.update({
            effects: setActiveCellEffect.of(activeCell),
            selection: { anchor: tableFrom + 2 },
        }).state;

        const { event } = createViewUpdate(startState, {
            selection: { anchor: 0 },
        });
        const snapshot: TableRuntimeSnapshot = {
            activeCell,
            prevActiveCell: activeCell,
            resolvedActiveCell: requireResolvedActiveCell(startState),
            resolvedPrevActiveCell: requireResolvedActiveCell(startState),
            effectiveRawMode: false,
            nestedEditorOpen: true,
            hadActiveCell: true,
            pendingFullReplaceRebuild: false,
        };

        expect(planTableLifecycleActions(snapshot, event, { cursorInsideTableAfterUndoRedo: false })).toEqual([
            { type: 'closeNestedEditor', useResolvedRangeFromUpdate: false },
            { type: 'clearActiveCell' },
        ]);
    });

    it('does not clear the active cell when selection leaves the table after the nested editor already closed', () => {
        const prefixedDoc = ['before', '', doc, '', 'after'].join('\n');
        const tableFrom = 'before\n\n'.length;
        const activeCell: ActiveCell = {
            tableFrom,
            section: 'header',
            row: 0,
            col: 0,
        };
        let startState = createMarkdownState(prefixedDoc, [
            activeCellField,
            cellSelectionField,
            sourceModeField,
            searchForceSourceModeField,
        ]);
        startState = startState.update({
            effects: setActiveCellEffect.of(activeCell),
            selection: { anchor: tableFrom + 2 },
        }).state;

        const { event } = createViewUpdate(startState, {
            selection: { anchor: 0 },
        });
        const snapshot: TableRuntimeSnapshot = {
            activeCell,
            prevActiveCell: activeCell,
            resolvedActiveCell: requireResolvedActiveCell(startState),
            resolvedPrevActiveCell: requireResolvedActiveCell(startState),
            effectiveRawMode: false,
            nestedEditorOpen: false,
            hadActiveCell: true,
            pendingFullReplaceRebuild: false,
        };

        expect(planTableLifecycleActions(snapshot, event, { cursorInsideTableAfterUndoRedo: false })).toEqual([]);
    });

    it('plans stale active cell cleanup when the nested editor is gone', () => {
        const activeCell = getHeaderCell();
        const startState = createState({ activeCell });
        const resolved = requireResolvedActiveCell(startState);
        const { event } = createViewUpdate(startState, {
            changes: { from: resolved.editableFrom, to: resolved.editableFrom, insert: 'x' },
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

    it('does not require rebuild when undo change range stays within the editable span', () => {
        const paddedDoc = ['| H1  | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
        let state = createMarkdownState(paddedDoc, [
            activeCellField,
            cellSelectionField,
            sourceModeField,
            searchForceSourceModeField,
        ]);
        state = state.update({ effects: setActiveCellEffect.of(getHeaderCell()) }).state;
        const resolved = requireResolvedActiveCell(state);

        const tr = state.update({
            changes: { from: resolved.editableFrom, to: resolved.editableTo, insert: 'H1 ' },
            annotations: Transaction.userEvent.of('undo'),
        });

        expect(transactionRequiresTableRebuild(tr, resolved)).toBe(false);
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
