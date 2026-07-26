import { describe, expect, it } from 'vitest';
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
    reduceTableRuntime,
    type TableRuntimeAction,
    type TableRuntimeFacts,
} from '../tableRuntime/lifecycle/lifecyclePolicy';
import { transactionRequiresTableRebuild } from '../tableRuntime/tableTransactionHelpers';
import { decideMainEditorGuardTransaction } from '../editorBridge/mainEditorGuardPolicy';
import { decideTableDecorationUpdate } from '../tableWidget/tableDecorationPolicy';
import { syncAnnotation } from '../editorBridge/syncAnnotation';
import { createMarkdownState } from './testMarkdownState';
import {
    normalizeBeforeEditAnnotation,
    planNormalizeTableBeforeOpen,
} from '../tableRuntime/lifecycle/tableNormalization';
import { createActiveCellForTableText } from '../tableRuntime/activeCell/activeCellFactory';
import {
    beginOpenCellRequestEffect,
    openCellRequestField,
    triggerOpenCellRequestEffect,
    type OpenCellRequest,
} from '../tableRuntime/openCellRequest';

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

function createOpenRequest(params: { activeCell: ActiveCell; normalizeIfNeeded: boolean }): OpenCellRequest {
    return {
        requestId: 'test-open-request',
        activeCell: params.activeCell,
        normalizeIfNeeded: params.normalizeIfNeeded,
        initialCursorPos: 'end',
        suppressKeys: false,
    };
}

function addPendingOpenRequest(state: EditorState, request: OpenCellRequest): EditorState {
    return state.update({ effects: beginOpenCellRequestEffect.of(request) }).state;
}

function requireResolvedActiveCell(state: EditorState) {
    const resolved = resolveActiveCell(state, getActiveCell(state));
    if (!resolved) {
        throw new Error('Expected resolved active cell');
    }
    return resolved;
}

function defaultRuntimeFacts(overrides: Partial<TableRuntimeFacts> = {}): TableRuntimeFacts {
    return {
        activeCell: { status: 'absent' },
        activeCellBefore: 'absent',
        activeCellIdentityUnchanged: false,
        effectiveRawMode: false,
        nestedEditorOpen: false,
        pendingFullReplaceRebuild: false,
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
        rebuildTouchesPreviousActiveTable: false,
        isUndoRedoInsideTable: false,
        hasInsertedTableActivation: false,
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
            name: 'explicit open suppresses other lifecycle work but keeps inserted-table activation',
            overrides: {
                activeCell: { status: 'resolved', selectionLeftActiveTable: true },
                activeCellBefore: 'resolved',
                nestedEditorOpen: true,
                docChanged: true,
                selectionChanged: true,
                hasFullDocumentReplace: true,
                rebuildTouchesPreviousActiveTable: true,
                rawModeTransition: {
                    enteredRawMode: true,
                    exitedRawMode: false,
                    exitedSourceMode: false,
                    exitedSearchForce: false,
                },
                openRequestId: 'explicit-request',
                hasInsertedTableActivation: true,
            },
            expected: [
                { type: 'openRequestedCell', requestId: 'explicit-request' },
                { type: 'scheduleInsertedTableActivation' },
            ],
        },
        {
            name: 'inserted-table activation is appended after a reposition terminal branch',
            overrides: {
                activeCell: { status: 'resolved', selectionLeftActiveTable: false },
                activeCellBefore: 'resolved',
                nestedEditorOpen: true,
                docChanged: true,
                rebuildTouchesPreviousActiveTable: true,
                hasInsertedTableActivation: true,
            },
            expected: [
                { type: 'closeNestedEditor', reason: 'cellReposition' },
                {
                    type: 'scheduleActivateCellAtCursor',
                    options: {
                        clearIfOutside: true,
                        ensureCursorVisibleIfNotActivated: false,
                        normalizeIfNeeded: false,
                        preserveMainSelection: false,
                    },
                },
                { type: 'scheduleInsertedTableActivation' },
            ],
        },
        {
            name: 'full-replace rebuild precedes raw-mode exit activation',
            overrides: {
                activeCellBefore: 'resolved',
                hasFullDocumentReplace: true,
                rawModeTransition: {
                    enteredRawMode: false,
                    exitedRawMode: true,
                    exitedSourceMode: true,
                    exitedSearchForce: false,
                },
            },
            expected: [
                { type: 'scheduleRebuildAllAfterFullReplace' },
                {
                    type: 'scheduleActivateCellAtCursor',
                    options: {
                        clearIfOutside: false,
                        ensureCursorVisibleIfNotActivated: true,
                        normalizeIfNeeded: false,
                        preserveMainSelection: true,
                    },
                },
            ],
        },
        {
            name: 'source-mode exit suppresses visibility, reposition, selection cleanup, and continuing work',
            overrides: {
                activeCell: { status: 'resolved', selectionLeftActiveTable: true },
                activeCellBefore: 'resolved',
                nestedEditorOpen: true,
                docChanged: true,
                selectionChanged: true,
                rebuildTouchesPreviousActiveTable: true,
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
                        normalizeIfNeeded: false,
                        preserveMainSelection: true,
                    },
                },
            ],
        },
        {
            name: 'visibility work precedes reposition',
            overrides: {
                activeCell: { status: 'resolved', selectionLeftActiveTable: true },
                activeCellBefore: 'resolved',
                nestedEditorOpen: true,
                docChanged: true,
                selectionChanged: true,
                rebuildTouchesPreviousActiveTable: true,
                rawModeTransition: {
                    enteredRawMode: true,
                    exitedRawMode: false,
                    exitedSourceMode: false,
                    exitedSearchForce: false,
                },
            },
            expected: [
                { type: 'scheduleEnsureCursorVisible', mode: 'enteredRawMode' },
                { type: 'closeNestedEditor', reason: 'cellReposition' },
                {
                    type: 'scheduleActivateCellAtCursor',
                    options: {
                        clearIfOutside: true,
                        ensureCursorVisibleIfNotActivated: false,
                        normalizeIfNeeded: false,
                        preserveMainSelection: false,
                    },
                },
            ],
        },
        {
            name: 'selection cleanup wins over sync and stale cleanup',
            overrides: {
                activeCell: { status: 'resolved', selectionLeftActiveTable: true },
                activeCellBefore: 'resolved',
                nestedEditorOpen: true,
                docChanged: true,
                selectionChanged: true,
                activeCellIdentityUnchanged: true,
            },
            expected: [{ type: 'closeNestedEditor', reason: 'selectionLeftActiveTable' }, { type: 'clearActiveCell' }],
        },
        {
            name: 'continuing active-cell removal follows accumulated full-replace rebuild work',
            overrides: {
                activeCell: { status: 'absent' },
                activeCellBefore: 'resolved',
                docChanged: true,
                hasFullDocumentReplace: true,
            },
            expected: [
                { type: 'scheduleRebuildAllAfterFullReplace' },
                { type: 'closeNestedEditor', reason: 'activeCellRemoved' },
            ],
        },
        {
            name: 'continuing stale cleanup follows accumulated full-replace rebuild work',
            overrides: {
                activeCell: { status: 'unresolved' },
                activeCellBefore: 'resolved',
                docChanged: true,
                hasFullDocumentReplace: true,
            },
            expected: [{ type: 'scheduleRebuildAllAfterFullReplace' }, { type: 'clearActiveCell' }],
        },
    ])('$name', ({ overrides, expected }) => {
        expect(reduceTableRuntime(defaultRuntimeFacts(overrides))).toEqual(expected);
    });

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
                    normalizeIfNeeded: false,
                    preserveMainSelection: true,
                },
            },
        ]);
    });

    it('appends inserted-table activation after explicit open requests', () => {
        const facts = defaultRuntimeFacts({
            activeCell: { status: 'resolved', selectionLeftActiveTable: false },
            nestedEditorOpen: true,
            activeCellBefore: 'resolved',
            hasInsertedTableActivation: true,
            openRequestId: 'explicit-request',
            rebuildTouchesPreviousActiveTable: true,
        });

        expect(reduceTableRuntime(facts)).toEqual([
            { type: 'openRequestedCell', requestId: 'explicit-request' },
            { type: 'scheduleInsertedTableActivation' },
        ]);
    });

    it('appends inserted-table activation after raw-mode exit actions', () => {
        const facts = defaultRuntimeFacts({
            activeCell: { status: 'unresolved' },
            activeCellBefore: 'resolved',
            hasInsertedTableActivation: true,
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
                    normalizeIfNeeded: false,
                    preserveMainSelection: true,
                },
            },
            { type: 'scheduleInsertedTableActivation' },
        ]);
    });

    it('plans inserted-table activation when no other lifecycle work is needed', () => {
        expect(reduceTableRuntime(defaultRuntimeFacts({ hasInsertedTableActivation: true }))).toEqual([
            { type: 'scheduleInsertedTableActivation' },
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
            effects: [setActiveCellEffect.of(nextActiveCell.activeCell), rebuildTableWidgetsEffect.of(undefined)],
            annotations: normalizeBeforeEditAnnotation.of(true),
        });
        const facts = defaultRuntimeFacts({
            activeCell: { status: 'resolved', selectionLeftActiveTable: false },
            activeCellBefore: 'resolved',
            docChanged: true,
            selectionChanged: true,
            isNormalizeBeforeEdit: true,
            hasFullDocumentReplace: true,
            openRequestId: 'normalize-request',
        });

        expect(decideTableDecorationUpdate(tr)).toEqual({ type: 'rebuildAllDecorations' });
        expect(decideMainEditorGuardTransaction(tr, { nestedEditorOpen: true })).toEqual({
            type: 'allowTransaction',
        });
        expect(reduceTableRuntime(facts)).toEqual([{ type: 'openRequestedCell', requestId: 'normalize-request' }]);
    });

    it('does not plan normalization when disabled or already canonical', () => {
        const activeCell = getHeaderCell();
        const nonCanonicalState = createMarkdownState(['|H1|H2|', '|---|---|', '|a1|a2|'].join('\n'), [
            activeCellField,
            openCellRequestField,
        ]).update({ effects: setActiveCellEffect.of(activeCell) }).state;
        const disabledRequest = createOpenRequest({ activeCell, normalizeIfNeeded: false });
        const nonCanonicalStateWithRequest = addPendingOpenRequest(nonCanonicalState, disabledRequest);
        const nonCanonicalResolved = requireResolvedActiveCell(nonCanonicalStateWithRequest);

        expect(
            planNormalizeTableBeforeOpen({
                state: nonCanonicalStateWithRequest,
                resolvedActiveCell: nonCanonicalResolved,
                request: disabledRequest,
            })
        ).toEqual({ type: 'not-needed' });

        const canonicalActiveCell = { ...activeCell, tableFrom: 1 };
        let canonicalState = createMarkdownState(`\n${doc}\n`, [activeCellField, openCellRequestField]);
        canonicalState = canonicalState.update({ effects: setActiveCellEffect.of(canonicalActiveCell) }).state;
        const canonicalRequest = createOpenRequest({ activeCell: canonicalActiveCell, normalizeIfNeeded: true });
        canonicalState = addPendingOpenRequest(canonicalState, canonicalRequest);
        const canonicalResolved = requireResolvedActiveCell(canonicalState);

        expect(
            planNormalizeTableBeforeOpen({
                state: canonicalState,
                resolvedActiveCell: canonicalResolved,
                request: canonicalRequest,
            })
        ).toEqual({ type: 'not-needed' });
    });

    it('plans a normalization dispatch that remaps active cell and retriggers open request', () => {
        const nonCanonicalDoc = ['|H1|H2|', '|---|---|', '|a1|a2|'].join('\n');
        const activeCell: ActiveCell = {
            tableFrom: 0,
            section: 'body',
            row: 0,
            col: 1,
        };
        let state = createMarkdownState(nonCanonicalDoc, [activeCellField, openCellRequestField]);
        state = state.update({ effects: setActiveCellEffect.of(activeCell) }).state;
        const request = createOpenRequest({ activeCell, normalizeIfNeeded: true });
        state = addPendingOpenRequest(state, request);
        const resolved = requireResolvedActiveCell(state);

        const plan = planNormalizeTableBeforeOpen({
            state,
            resolvedActiveCell: resolved,
            request,
        });

        expect(plan.type).toBe('dispatch');
        if (plan.type !== 'dispatch') {
            throw new Error('Expected normalization dispatch plan');
        }

        const tr = state.update(plan.spec);
        expect(tr.state.doc.toString()).toBe(`\n${doc}\n`);
        expect(getActiveCell(tr.state)).toEqual({
            tableFrom: 1,
            section: 'body',
            row: 0,
            col: 1,
        });
        expect(tr.state.selection.main.anchor).toBeGreaterThan(0);
        expect(tr.annotation(normalizeBeforeEditAnnotation)).toBe(true);
        expect(tr.effects.some((effect) => effect.is(rebuildTableWidgetsEffect))).toBe(true);
        expect(
            tr.effects.some(
                (effect) =>
                    effect.is(beginOpenCellRequestEffect) &&
                    effect.value.requestId === 'test-open-request' &&
                    effect.value.normalizeIfNeeded === false &&
                    effect.value.activeCell.tableFrom === 1
            )
        ).toBe(true);
        expect(
            tr.effects.some(
                (effect) => effect.is(triggerOpenCellRequestEffect) && effect.value.requestId === 'test-open-request'
            )
        ).toBe(true);
    });

    it('aborts normalization when the open request is stale', () => {
        const activeCell = getHeaderCell();
        let state = createMarkdownState(['|H1|H2|', '|---|---|', '|a1|a2|'].join('\n'), [
            activeCellField,
            openCellRequestField,
        ]);
        state = state.update({ effects: setActiveCellEffect.of(activeCell) }).state;
        const resolved = requireResolvedActiveCell(state);

        expect(
            planNormalizeTableBeforeOpen({
                state,
                resolvedActiveCell: resolved,
                request: createOpenRequest({ activeCell, normalizeIfNeeded: true }),
            })
        ).toEqual({ type: 'aborted' });
    });

    it('does not plan a generic reopen for rebuild-only transactions', () => {
        const facts = defaultRuntimeFacts({
            activeCell: { status: 'resolved', selectionLeftActiveTable: false },
            nestedEditorOpen: true,
            activeCellBefore: 'resolved',
        });

        expect(reduceTableRuntime(facts)).toEqual([]);
    });

    it('plans nested editor sync from document changes or same-cell selection changes', () => {
        const facts = defaultRuntimeFacts({
            activeCell: { status: 'resolved', selectionLeftActiveTable: false },
            nestedEditorOpen: true,
            activeCellBefore: 'resolved',
        });

        expect(reduceTableRuntime({ ...facts, docChanged: true })).toContainEqual({
            type: 'syncMainToNested',
        });
        expect(
            reduceTableRuntime({ ...facts, selectionChanged: true, activeCellIdentityUnchanged: true })
        ).toContainEqual({ type: 'syncMainToNested' });
        expect(reduceTableRuntime({ ...facts, selectionChanged: true })).toEqual([]);
    });

    it('prefers an explicit open request over generic branches', () => {
        const facts = defaultRuntimeFacts({
            activeCell: { status: 'resolved', selectionLeftActiveTable: true },
            nestedEditorOpen: true,
            activeCellBefore: 'resolved',
            docChanged: true,
            hasFullDocumentReplace: true,
            openRequestId: 'explicit-request',
            rebuildTouchesPreviousActiveTable: true,
            selectionChanged: true,
        });

        expect(reduceTableRuntime(facts)).toEqual([{ type: 'openRequestedCell', requestId: 'explicit-request' }]);
    });

    it('uses the classified open request id', () => {
        const facts = defaultRuntimeFacts({
            activeCell: { status: 'resolved', selectionLeftActiveTable: false },
            nestedEditorOpen: true,
            activeCellBefore: 'resolved',
            openRequestId: 'latest-request',
        });

        expect(reduceTableRuntime(facts)).toEqual([{ type: 'openRequestedCell', requestId: 'latest-request' }]);
    });

    it('uses the resolved update range when undo or redo repositions the active cell', () => {
        const facts = defaultRuntimeFacts({
            activeCell: { status: 'resolved', selectionLeftActiveTable: false },
            nestedEditorOpen: true,
            activeCellBefore: 'resolved',
            docChanged: true,
            rebuildTouchesPreviousActiveTable: true,
        });

        expect(reduceTableRuntime(facts)).toEqual([
            { type: 'closeNestedEditor', reason: 'cellReposition' },
            {
                type: 'scheduleActivateCellAtCursor',
                options: {
                    clearIfOutside: true,
                    ensureCursorVisibleIfNotActivated: false,
                    normalizeIfNeeded: false,
                    preserveMainSelection: false,
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
                    normalizeIfNeeded: false,
                    preserveMainSelection: false,
                },
            },
        ]);
    });

    it('closes and clears the active cell when selection moves outside the active table', () => {
        const facts = defaultRuntimeFacts({
            activeCell: { status: 'resolved', selectionLeftActiveTable: true },
            nestedEditorOpen: true,
            activeCellBefore: 'resolved',
            selectionChanged: true,
        });

        expect(reduceTableRuntime(facts)).toEqual([
            { type: 'closeNestedEditor', reason: 'selectionLeftActiveTable' },
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
            activeCell: { status: 'resolved', selectionLeftActiveTable: true },
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
            activeCell: { status: 'resolved', selectionLeftActiveTable: true },
            nestedEditorOpen: false,
            activeCellBefore: 'resolved',
            selectionChanged: true,
        });

        expect(reduceTableRuntime(facts)).toEqual([]);
    });

    it('plans stale active cell cleanup when the nested editor is gone', () => {
        const facts = defaultRuntimeFacts({
            activeCell: { status: 'resolved', selectionLeftActiveTable: false },
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

        expect(transactionRequiresTableRebuild(tr, resolved)).toBe(false);
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
