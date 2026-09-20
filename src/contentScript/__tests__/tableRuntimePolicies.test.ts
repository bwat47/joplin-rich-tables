import { describe, expect, it } from 'vitest';
import { EditorState, Transaction } from '@codemirror/state';
import { activeCellField, getActiveCell, setActiveCellEffect, type ActiveCell } from '../tableState/activeCellState';
import { cellSelectionField, setCellSelectionEffect } from '../tableState/cellSelectionState';
import { resolveActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import { structuralTableEditEffect } from '../tableState/structuralTableEditEffect';
import { sourceModeField } from '../tableState/sourceMode';
import { searchForceSourceModeField, setSearchForceSourceModeEffect } from '../tableState/searchForceSourceMode';
import {
    reduceTableRuntime,
    type ActiveCellFacts,
    type TableRuntimeAction,
    type TableRuntimeFacts,
} from '../tableRuntime/lifecycle/lifecyclePolicy';
import { classifyActiveCellChanges } from '../tableRuntime/activeCell/activeCellChangeScope';
import { decideMainEditorGuardTransaction } from '../editorBridge/mainEditorGuardPolicy';
import { syncAnnotation } from '../editorBridge/syncAnnotation';
import { tableDecorationField, wasActiveHostInvalidated } from '../tableWidget/tableDecorationField';
import { createMarkdownState } from './testMarkdownState';
import { normalizeBeforeEditAnnotation } from '../tableRuntime/tableCanonicalForm';
import { triggerOpenCellRequestEffect } from '../tableRuntime/openCellRequest';
import { createActiveCellForTable } from '../tableRuntime/activeCell/activeCellFactory';
import { parseTableFixture } from './testUtils';

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

const RESOLVED_HEADER_CELL = requireResolvedActiveCell(createState({ activeCell: getHeaderCell() }));
const RESOLVED_HEADER_CELL_RANGE = {
    contentFrom: RESOLVED_HEADER_CELL.contentFrom,
    contentTo: RESOLVED_HEADER_CELL.contentTo,
};

function resolvedActiveCellFacts(selectionLeftActiveTable: boolean): ActiveCellFacts {
    return {
        status: 'resolved',
        resolvedCell: RESOLVED_HEADER_CELL,
        selectionLeftActiveTable,
    };
}

function defaultRuntimeFacts(overrides: Partial<TableRuntimeFacts> = {}): TableRuntimeFacts {
    return {
        activeCell: { status: 'absent' },
        activeCellBefore: 'absent',
        activeCellIdentityUnchanged: false,
        effectiveRawMode: false,
        nestedEditorOpen: false,
        docChanged: false,
        selectionChanged: false,
        isSync: false,
        isCellSelectionTransition: false,
        cellDragInProgress: false,
        rawModeTransition: {
            enteredRawMode: false,
            exitedRawMode: false,
            exitedSourceMode: false,
            exitedSearchForce: false,
        },
        activeHostInvalidated: false,
        isUndoRedoInsideTable: false,
        noteChanged: false,
        openRequestId: null,
        ...overrides,
    };
}

describe('tableRuntimePolicies', () => {
    it.each<{
        name: string;
        overrides: Partial<TableRuntimeFacts>;
        expected: TableRuntimeAction[];
    }>([
        {
            name: 'explicit open suppresses other lifecycle work',
            overrides: {
                activeCell: resolvedActiveCellFacts(true),
                activeCellBefore: 'resolved',
                nestedEditorOpen: true,
                docChanged: true,
                selectionChanged: true,
                activeHostInvalidated: true,
                rawModeTransition: {
                    enteredRawMode: true,
                    exitedRawMode: false,
                    exitedSourceMode: false,
                    exitedSearchForce: false,
                },
                openRequestId: 'explicit-request',
            },
            expected: [{ type: 'openRequestedCell', requestId: 'explicit-request' }],
        },
        {
            name: 'reposition closes the nested editor and reactivates at the cursor',
            overrides: {
                activeCell: resolvedActiveCellFacts(false),
                activeCellBefore: 'resolved',
                nestedEditorOpen: true,
                docChanged: true,
                activeHostInvalidated: true,
            },
            expected: [
                { type: 'closeNestedEditor', reason: 'cellReposition', mappedRange: RESOLVED_HEADER_CELL_RANGE },
                {
                    type: 'scheduleActivateCellAtCursor',
                    options: {
                        clearIfOutside: true,
                        ensureCursorVisibleIfNotActivated: false,
                        entryMode: 'enter',
                    },
                },
            ],
        },
        {
            name: 'source-mode exit suppresses visibility, reposition, selection cleanup, and continuing work',
            overrides: {
                activeCell: resolvedActiveCellFacts(true),
                activeCellBefore: 'resolved',
                nestedEditorOpen: true,
                docChanged: true,
                selectionChanged: true,
                activeHostInvalidated: true,
                rawModeTransition: {
                    enteredRawMode: true,
                    exitedRawMode: false,
                    exitedSourceMode: true,
                    exitedSearchForce: false,
                },
            },
            expected: [
                {
                    type: 'scheduleActivateCellAtCursor',
                    options: {
                        clearIfOutside: false,
                        ensureCursorVisibleIfNotActivated: true,
                        entryMode: 'adopt',
                    },
                },
            ],
        },
        {
            name: 'search-force exit plans cursor reactivation instead of raw-mode exit visibility work',
            overrides: {
                activeCell: { status: 'absent' },
                rawModeTransition: {
                    enteredRawMode: false,
                    exitedRawMode: true,
                    exitedSourceMode: false,
                    exitedSearchForce: true,
                },
            },
            expected: [
                {
                    type: 'scheduleActivateCellAtCursor',
                    options: {
                        clearIfOutside: false,
                        ensureCursorVisibleIfNotActivated: true,
                        entryMode: 'adopt',
                    },
                },
            ],
        },
        {
            name: 'visibility work precedes reposition',
            overrides: {
                activeCell: resolvedActiveCellFacts(true),
                activeCellBefore: 'resolved',
                nestedEditorOpen: true,
                docChanged: true,
                selectionChanged: true,
                activeHostInvalidated: true,
                rawModeTransition: {
                    enteredRawMode: true,
                    exitedRawMode: false,
                    exitedSourceMode: false,
                    exitedSearchForce: false,
                },
            },
            expected: [
                { type: 'scheduleEnsureCursorVisible', mode: 'enteredRawMode' },
                { type: 'closeNestedEditor', reason: 'cellReposition', mappedRange: RESOLVED_HEADER_CELL_RANGE },
                {
                    type: 'scheduleActivateCellAtCursor',
                    options: {
                        clearIfOutside: true,
                        ensureCursorVisibleIfNotActivated: false,
                        entryMode: 'enter',
                    },
                },
            ],
        },
        {
            name: 'selection cleanup wins over sync and stale cleanup',
            overrides: {
                activeCell: resolvedActiveCellFacts(true),
                activeCellBefore: 'resolved',
                nestedEditorOpen: true,
                docChanged: true,
                selectionChanged: true,
                activeCellIdentityUnchanged: true,
            },
            expected: [
                {
                    type: 'closeNestedEditor',
                    reason: 'selectionLeftActiveTable',
                    mappedRange: RESOLVED_HEADER_CELL_RANGE,
                },
                { type: 'clearActiveCell' },
            ],
        },
        {
            name: 'a mouse cell drag keeps its anchor editor open while the caret follows the pointer',
            overrides: {
                activeCell: resolvedActiveCellFacts(true),
                activeCellBefore: 'resolved',
                nestedEditorOpen: true,
                selectionChanged: true,
                activeCellIdentityUnchanged: true,
                cellDragInProgress: true,
            },
            expected: [],
        },
        {
            name: 'a full replace that invalidates the open cell repositions to the cell under the cursor',
            overrides: {
                activeCell: { status: 'absent' },
                activeCellBefore: 'resolved',
                nestedEditorOpen: true,
                docChanged: true,
                activeHostInvalidated: true,
            },
            expected: [
                { type: 'closeNestedEditor', reason: 'cellReposition' },
                {
                    type: 'scheduleActivateCellAtCursor',
                    options: {
                        clearIfOutside: true,
                        ensureCursorVisibleIfNotActivated: false,
                        entryMode: 'enter',
                    },
                },
            ],
        },
    ])('$name', ({ overrides, expected }) => {
        expect(reduceTableRuntime(defaultRuntimeFacts(overrides))).toEqual(expected);
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

    it.each([
        ['an insertion at the table start', (ctx: { from: number; to: number }) => ({ from: ctx.from, insert: 'x' })],
        ['an insertion at the table end', (ctx: { from: number; to: number }) => ({ from: ctx.to, insert: 'x' })],
        [
            'a deletion ending at the table start',
            (ctx: { from: number; to: number }) => ({ from: ctx.from - 1, to: ctx.from }),
        ],
    ])('%s is a table edit to both the guard and the decoration field', (_name, change) => {
        const prefix = 'before\n\n';
        let state = createMarkdownState(`${prefix}${doc}`, [
            activeCellField,
            cellSelectionField,
            sourceModeField,
            searchForceSourceModeField,
            tableDecorationField,
        ]);
        state = state.update({
            effects: setActiveCellEffect.of({
                tableFrom: prefix.length,
                section: 'header',
                row: 0,
                col: 0,
            }),
        }).state;
        const resolved = requireResolvedActiveCell(state);
        const tr = state.update({ changes: change(resolved.ctx) });

        expect(decideMainEditorGuardTransaction(tr, { nestedEditorOpen: true })).toEqual({
            type: 'rejectTransaction',
        });
        expect(wasActiveHostInvalidated(tr.state)).toBe(true);
    });

    it('allows guard changes strictly outside the active table', () => {
        const prefix = 'before\n\n';
        let state = createMarkdownState(`${prefix}${doc}`, [
            activeCellField,
            cellSelectionField,
            sourceModeField,
            searchForceSourceModeField,
        ]);
        state = state.update({
            effects: setActiveCellEffect.of({
                tableFrom: prefix.length,
                section: 'header',
                row: 0,
                col: 0,
            }),
        }).state;
        const tr = state.update({ changes: { from: 0, insert: 'more ' } });

        expect(decideMainEditorGuardTransaction(tr, { nestedEditorOpen: true })).toEqual({
            type: 'allowTransaction',
        });
    });

    it('clears the active cell on a full document replace', () => {
        const state = createState({ activeCell: getHeaderCell() });
        const tr = state.update({
            changes: { from: 0, to: doc.length, insert: '# replaced' },
            selection: { anchor: 3 },
        });

        const decision = decideMainEditorGuardTransaction(tr, { nestedEditorOpen: true });

        expect(decision.type).toBe('clearActiveCell');
        if (decision.type !== 'clearActiveCell') {
            throw new Error('Expected clear active cell decision');
        }

        expect(decision.selection?.main.head).toBe(3);
    });

    it('allows a full document replace through when no active cell is set', () => {
        const state = createState();
        const tr = state.update({
            changes: { from: 0, to: doc.length, insert: '# replaced' },
        });

        expect(decideMainEditorGuardTransaction(tr, { nestedEditorOpen: true })).toEqual({
            type: 'allowTransaction',
        });
    });

    it('clears an active cell that no longer resolves against the document', () => {
        const state = createState({ activeCell: { tableFrom: 0, section: 'body', row: 9, col: 0 } });
        const tr = state.update({
            changes: { from: 0, to: 1, insert: '' },
        });

        expect(decideMainEditorGuardTransaction(tr, { nestedEditorOpen: true })).toEqual({
            type: 'clearActiveCell',
            selection: undefined,
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

    it('rewrites single-change but not multi-change paste transactions', () => {
        const state = createMarkdownState(['', 'after'].join('\n'), [
            activeCellField,
            cellSelectionField,
            sourceModeField,
            searchForceSourceModeField,
        ]);
        const pasteText = ['|H1|H2|', '|---|---|', '|a|b|'].join('\n');
        const singleChangeTr = state.update({
            changes: { from: 0, to: 0, insert: pasteText },
            userEvent: 'input.paste',
        });
        const multiChangeTr = state.update({
            changes: [
                { from: 0, to: 0, insert: pasteText },
                { from: state.doc.length, to: state.doc.length, insert: 'x' },
            ],
            userEvent: 'input.paste',
        });

        expect(decideMainEditorGuardTransaction(singleChangeTr, { nestedEditorOpen: false })).toMatchObject({
            type: 'rewriteRootTablePaste',
        });
        expect(decideMainEditorGuardTransaction(multiChangeTr, { nestedEditorOpen: false })).toEqual({
            type: 'allowTransaction',
        });
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

        expect(decision.selection.main.head).toBe(resolved.editableFrom + String.raw`a<br>b\|c`.length);
    });

    it('plans raw mode exit as cursor reactivation', () => {
        const facts = defaultRuntimeFacts({
            activeCell: { status: 'unresolved' },
            activeCellBefore: 'resolved',
            rawModeTransition: {
                enteredRawMode: false,
                exitedRawMode: true,
                exitedSourceMode: true,
                exitedSearchForce: false,
            },
        });

        expect(reduceTableRuntime(facts)).toEqual([
            {
                type: 'scheduleActivateCellAtCursor',
                options: {
                    clearIfOutside: false,
                    ensureCursorVisibleIfNotActivated: true,
                    entryMode: 'adopt',
                },
            },
        ]);
    });

    it('plans only note-switch cleanup when the note changes, ahead of every reactivation path', () => {
        const facts = defaultRuntimeFacts({
            noteChanged: true,
            docChanged: true,
            activeCell: { status: 'absent' },
            activeCellBefore: 'resolved',
            activeHostInvalidated: true,
            openRequestId: 'explicit-request',
            rawModeTransition: {
                enteredRawMode: false,
                exitedRawMode: true,
                exitedSourceMode: true,
                exitedSearchForce: false,
            },
        });

        expect(reduceTableRuntime(facts)).toEqual([{ type: 'scheduleNoteSwitchCleanup' }]);
    });

    it('closes an open nested editor before note-switch cleanup', () => {
        const facts = defaultRuntimeFacts({
            noteChanged: true,
            docChanged: true,
            nestedEditorOpen: true,
            activeCellBefore: 'resolved',
            activeHostInvalidated: true,
        });

        expect(reduceTableRuntime(facts)).toEqual([
            { type: 'closeNestedEditor', reason: 'noteChanged' },
            { type: 'scheduleNoteSwitchCleanup' },
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
        const nextActiveCell = createActiveCellForTable({
            tableFrom: 0,
            serialized: parseTableFixture(canonicalDoc).serializeWithOffsets(),
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
                structuralTableEditEffect.of(undefined),
                triggerOpenCellRequestEffect.of({ requestId: 'normalize-request' }),
            ],
            annotations: normalizeBeforeEditAnnotation.of(true),
        });
        const facts = defaultRuntimeFacts({
            activeCell: resolvedActiveCellFacts(false),
            activeCellBefore: 'resolved',
            docChanged: true,
            selectionChanged: true,
            openRequestId: 'normalize-request',
        });

        expect(decideMainEditorGuardTransaction(tr, { nestedEditorOpen: true })).toEqual({
            type: 'allowTransaction',
        });
        expect(reduceTableRuntime(facts)).toEqual([{ type: 'openRequestedCell', requestId: 'normalize-request' }]);
    });

    it('does not plan a generic reopen without an explicit request', () => {
        const facts = defaultRuntimeFacts({
            activeCell: resolvedActiveCellFacts(false),
            nestedEditorOpen: true,
            activeCellBefore: 'resolved',
        });

        expect(reduceTableRuntime(facts)).toEqual([]);
    });

    it('plans nested editor sync from document changes or same-cell selection changes', () => {
        const facts = defaultRuntimeFacts({
            activeCell: resolvedActiveCellFacts(false),
            nestedEditorOpen: true,
            activeCellBefore: 'resolved',
        });

        expect(reduceTableRuntime({ ...facts, docChanged: true })).toContainEqual({
            type: 'syncMainToNested',
            resolvedCell: RESOLVED_HEADER_CELL,
        });
        expect(
            reduceTableRuntime({ ...facts, selectionChanged: true, activeCellIdentityUnchanged: true })
        ).toContainEqual({ type: 'syncMainToNested', resolvedCell: RESOLVED_HEADER_CELL });
        expect(reduceTableRuntime({ ...facts, selectionChanged: true })).toEqual([]);
    });

    it('does not plan nested editor sync for an active cell that no longer resolves', () => {
        const facts = defaultRuntimeFacts({
            activeCell: { status: 'unresolved' },
            nestedEditorOpen: true,
            activeCellBefore: 'resolved',
            docChanged: true,
            selectionChanged: true,
            activeCellIdentityUnchanged: true,
        });

        expect(reduceTableRuntime(facts).some((action) => action.type === 'syncMainToNested')).toBe(false);
    });

    it('does not mirror cell-drag selection transitions into the retained nested editor', () => {
        const facts = defaultRuntimeFacts({
            activeCell: resolvedActiveCellFacts(false),
            nestedEditorOpen: true,
            activeCellBefore: 'resolved',
            activeCellIdentityUnchanged: true,
            selectionChanged: true,
            isCellSelectionTransition: true,
            cellDragInProgress: true,
        });

        expect(reduceTableRuntime(facts)).toEqual([]);
    });

    it('prefers an explicit open request over generic branches', () => {
        const facts = defaultRuntimeFacts({
            activeCell: resolvedActiveCellFacts(true),
            nestedEditorOpen: true,
            activeCellBefore: 'resolved',
            docChanged: true,
            openRequestId: 'explicit-request',
            activeHostInvalidated: true,
            selectionChanged: true,
        });

        expect(reduceTableRuntime(facts)).toEqual([{ type: 'openRequestedCell', requestId: 'explicit-request' }]);
    });

    it('uses the classified open request id', () => {
        const facts = defaultRuntimeFacts({
            activeCell: resolvedActiveCellFacts(false),
            nestedEditorOpen: true,
            activeCellBefore: 'resolved',
            openRequestId: 'latest-request',
        });

        expect(reduceTableRuntime(facts)).toEqual([{ type: 'openRequestedCell', requestId: 'latest-request' }]);
    });

    it('uses the resolved update range when undo or redo repositions the active cell', () => {
        const facts = defaultRuntimeFacts({
            activeCell: resolvedActiveCellFacts(false),
            nestedEditorOpen: true,
            activeCellBefore: 'resolved',
            docChanged: true,
            activeHostInvalidated: true,
        });

        expect(reduceTableRuntime(facts)).toEqual([
            { type: 'closeNestedEditor', reason: 'cellReposition', mappedRange: RESOLVED_HEADER_CELL_RANGE },
            {
                type: 'scheduleActivateCellAtCursor',
                options: {
                    clearIfOutside: true,
                    ensureCursorVisibleIfNotActivated: false,
                    entryMode: 'enter',
                },
            },
        ]);
    });

    it('repositions after undo or redo inside a table without a resolved previous active cell', () => {
        const facts = defaultRuntimeFacts({
            docChanged: true,
            isUndoRedoInsideTable: true,
        });

        expect(reduceTableRuntime(facts)).toEqual([
            {
                type: 'scheduleActivateCellAtCursor',
                options: {
                    clearIfOutside: true,
                    ensureCursorVisibleIfNotActivated: false,
                    entryMode: 'enter',
                },
            },
        ]);
    });

    it('closes and clears the active cell when selection moves outside the active table', () => {
        const facts = defaultRuntimeFacts({
            activeCell: resolvedActiveCellFacts(true),
            nestedEditorOpen: true,
            activeCellBefore: 'resolved',
            selectionChanged: true,
        });

        expect(reduceTableRuntime(facts)).toEqual([
            { type: 'closeNestedEditor', reason: 'selectionLeftActiveTable', mappedRange: RESOLVED_HEADER_CELL_RANGE },
            { type: 'clearActiveCell' },
        ]);
    });

    it('closes the nested editor when the active cell disappears', () => {
        const facts = defaultRuntimeFacts({
            activeCell: { status: 'absent' },
            nestedEditorOpen: true,
            activeCellBefore: 'resolved',
        });

        expect(reduceTableRuntime(facts)).toEqual([{ type: 'closeNestedEditor', reason: 'activeCellRemoved' }]);
    });

    it('suppresses selection-left-table cleanup during raw mode, cell selection, and sync updates', () => {
        const facts = defaultRuntimeFacts({
            activeCell: resolvedActiveCellFacts(true),
            nestedEditorOpen: true,
            activeCellBefore: 'resolved',
            selectionChanged: true,
        });

        expect(reduceTableRuntime({ ...facts, effectiveRawMode: true })).toEqual([]);
        expect(reduceTableRuntime({ ...facts, isCellSelectionTransition: true })).toEqual([]);
        expect(reduceTableRuntime({ ...facts, isSync: true })).toEqual([]);
    });

    it('does not clear the active cell when selection leaves the table after the nested editor already closed', () => {
        const facts = defaultRuntimeFacts({
            activeCell: resolvedActiveCellFacts(true),
            nestedEditorOpen: false,
            activeCellBefore: 'resolved',
            selectionChanged: true,
        });

        expect(reduceTableRuntime(facts)).toEqual([]);
    });

    it('plans stale active cell cleanup when the nested editor is gone', () => {
        const facts = defaultRuntimeFacts({
            activeCell: resolvedActiveCellFacts(false),
            nestedEditorOpen: false,
            activeCellBefore: 'resolved',
            docChanged: true,
        });

        expect(reduceTableRuntime(facts)).toContainEqual({
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

        expect(classifyActiveCellChanges(tr.changes, resolved)).toBe('inCell');
    });

    it('clears stale active cell when the resolver cannot find the table', () => {
        const facts = defaultRuntimeFacts({
            activeCell: { status: 'unresolved' },
            nestedEditorOpen: false,
            activeCellBefore: 'resolved',
            docChanged: true,
        });

        expect(reduceTableRuntime(facts)).toContainEqual({
            type: 'clearActiveCell',
        });
    });
});
