import { describe, expect, it } from '@jest/globals';
import { EditorState, Transaction } from '@codemirror/state';
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
    planTableLifecycleActions,
    type TableLifecyclePolicyEvent,
    type TableLifecyclePolicyState,
} from '../tableRuntime/lifecycle/lifecyclePolicy';
import { transactionRequiresTableRebuild } from '../tableRuntime/tableTransactionHelpers';
import { decideMainEditorGuardTransaction } from '../editorBridge/mainEditorGuardPolicy';
import { decideTableDecorationUpdate } from '../tableWidget/tableDecorationPolicy';
import { syncAnnotation } from '../editorBridge/syncAnnotation';
import { createMarkdownState } from './testMarkdownState';
import { normalizeBeforeEditAnnotation } from '../tableRuntime/lifecycle/tableNormalization';
import { createActiveCellForTableText } from '../tableRuntime/activeCell/activeCellFactory';

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

function defaultPolicyState(overrides: Partial<TableLifecyclePolicyState> = {}): TableLifecyclePolicyState {
    return {
        hasActiveCell: false,
        currentActiveCellResolved: false,
        effectiveRawMode: false,
        nestedEditorOpen: false,
        hadActiveCell: false,
        pendingFullReplaceRebuild: false,
        ...overrides,
    };
}

function defaultPolicyEvent(overrides: Partial<TableLifecyclePolicyEvent> = {}): TableLifecyclePolicyEvent {
    return {
        docChanged: false,
        selectionChanged: false,
        isSync: false,
        isNormalizeBeforeEdit: false,
        isCellSelectionTransition: false,
        rawModeTransition: {
            enteredRawMode: false,
            exitedRawMode: false,
            exitedSourceMode: false,
            exitedSearchForce: false,
        },
        hasFullDocumentReplace: false,
        openRequestId: null,
        selectionLeftActiveTable: false,
        requiresCellReposition: false,
        shouldSyncMainToNested: false,
        ...overrides,
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
        const state = defaultPolicyState({
            hasActiveCell: true,
            hadActiveCell: true,
        });
        const event = defaultPolicyEvent({
            rawModeTransition: {
                enteredRawMode: false,
                exitedRawMode: true,
                exitedSourceMode: true,
                exitedSearchForce: false,
            },
        });

        expect(planTableLifecycleActions(state, event)).toEqual([
            {
                type: 'scheduleActivateCellAtCursor',
                reason: 'rawModeExit',
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
            ],
            annotations: normalizeBeforeEditAnnotation.of(true),
        });
        const state = defaultPolicyState({
            hasActiveCell: true,
            currentActiveCellResolved: true,
            hadActiveCell: true,
        });

        expect(decideTableDecorationUpdate(tr)).toEqual({ type: 'rebuildAllDecorations' });
        expect(decideMainEditorGuardTransaction(tr, { nestedEditorOpen: true })).toEqual({
            type: 'allowTransaction',
        });
        expect(
            planTableLifecycleActions(
                state,
                defaultPolicyEvent({
                    docChanged: true,
                    selectionChanged: true,
                    isNormalizeBeforeEdit: true,
                    hasFullDocumentReplace: true,
                    openRequestId: 'normalize-request',
                })
            )
        ).toEqual([{ type: 'openRequestedCell', requestId: 'normalize-request' }]);
    });

    it('does not plan a generic reopen for rebuild-only transactions', () => {
        const state = defaultPolicyState({
            hasActiveCell: true,
            currentActiveCellResolved: true,
            nestedEditorOpen: true,
            hadActiveCell: true,
        });

        expect(planTableLifecycleActions(state, defaultPolicyEvent())).toEqual([]);
    });

    it('plans nested editor sync from a single sync fact', () => {
        const state = defaultPolicyState({
            hasActiveCell: true,
            currentActiveCellResolved: true,
            nestedEditorOpen: true,
            hadActiveCell: true,
        });

        expect(planTableLifecycleActions(state, defaultPolicyEvent({ shouldSyncMainToNested: true }))).toContainEqual({
            type: 'syncMainToNested',
        });
        expect(planTableLifecycleActions(state, defaultPolicyEvent({ shouldSyncMainToNested: false }))).toEqual([]);
    });

    it('prefers an explicit open request over generic branches', () => {
        const state = defaultPolicyState({
            hasActiveCell: true,
            currentActiveCellResolved: true,
            nestedEditorOpen: true,
            hadActiveCell: true,
        });
        const event = defaultPolicyEvent({
            docChanged: true,
            hasFullDocumentReplace: true,
            openRequestId: 'explicit-request',
            requiresCellReposition: true,
            selectionChanged: true,
            selectionLeftActiveTable: true,
            shouldSyncMainToNested: true,
        });

        expect(planTableLifecycleActions(state, event)).toEqual([
            { type: 'openRequestedCell', requestId: 'explicit-request' },
        ]);
    });

    it('uses the compact open request id selected by the adapter', () => {
        const state = defaultPolicyState({
            hasActiveCell: true,
            currentActiveCellResolved: true,
            nestedEditorOpen: true,
            hadActiveCell: true,
        });
        const event = defaultPolicyEvent({ openRequestId: 'latest-request' });

        expect(planTableLifecycleActions(state, event)).toEqual([
            { type: 'openRequestedCell', requestId: 'latest-request' },
        ]);
    });

    it('uses the resolved update range when undo or redo repositions the active cell', () => {
        const state = defaultPolicyState({
            hasActiveCell: true,
            currentActiveCellResolved: true,
            nestedEditorOpen: true,
            hadActiveCell: true,
        });

        expect(
            planTableLifecycleActions(
                state,
                defaultPolicyEvent({
                    docChanged: true,
                    requiresCellReposition: true,
                })
            )
        ).toEqual([
            { type: 'closeNestedEditorUsingResolvedUpdateRange' },
            {
                type: 'scheduleActivateCellAtCursor',
                reason: 'cellReposition',
            },
        ]);
    });

    it('closes and clears the active cell when selection moves outside the active table', () => {
        const state = defaultPolicyState({
            hasActiveCell: true,
            currentActiveCellResolved: true,
            nestedEditorOpen: true,
            hadActiveCell: true,
        });

        expect(
            planTableLifecycleActions(
                state,
                defaultPolicyEvent({
                    selectionChanged: true,
                    selectionLeftActiveTable: true,
                })
            )
        ).toEqual([{ type: 'closeNestedEditor' }, { type: 'clearActiveCell' }]);
    });

    it('suppresses selection-left-table cleanup during raw mode, cell selection, and sync updates', () => {
        const state = defaultPolicyState({
            hasActiveCell: true,
            currentActiveCellResolved: true,
            nestedEditorOpen: true,
            hadActiveCell: true,
        });
        const event = defaultPolicyEvent({
            selectionChanged: true,
            selectionLeftActiveTable: true,
        });

        expect(planTableLifecycleActions(defaultPolicyState({ ...state, effectiveRawMode: true }), event)).toEqual([]);
        expect(
            planTableLifecycleActions(
                state,
                defaultPolicyEvent({
                    ...event,
                    isCellSelectionTransition: true,
                })
            )
        ).toEqual([]);
        expect(
            planTableLifecycleActions(
                state,
                defaultPolicyEvent({
                    ...event,
                    isSync: true,
                })
            )
        ).toEqual([]);
    });

    it('does not clear the active cell when selection leaves the table after the nested editor already closed', () => {
        const state = defaultPolicyState({
            hasActiveCell: true,
            currentActiveCellResolved: true,
            nestedEditorOpen: false,
            hadActiveCell: true,
        });

        expect(
            planTableLifecycleActions(
                state,
                defaultPolicyEvent({
                    selectionChanged: true,
                    selectionLeftActiveTable: true,
                })
            )
        ).toEqual([]);
    });

    it('plans stale active cell cleanup when the nested editor is gone', () => {
        const state = defaultPolicyState({
            hasActiveCell: true,
            currentActiveCellResolved: true,
            nestedEditorOpen: false,
            hadActiveCell: true,
        });

        expect(
            planTableLifecycleActions(
                state,
                defaultPolicyEvent({
                    docChanged: true,
                })
            )
        ).toContainEqual({
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
        const state = defaultPolicyState({
            hasActiveCell: true,
            currentActiveCellResolved: false,
            nestedEditorOpen: false,
            hadActiveCell: true,
        });

        expect(
            planTableLifecycleActions(
                state,
                defaultPolicyEvent({
                    docChanged: true,
                })
            )
        ).toContainEqual({
            type: 'clearActiveCell',
        });
    });
});
