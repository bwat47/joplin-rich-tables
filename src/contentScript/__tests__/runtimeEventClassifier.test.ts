import { type Extension, Transaction } from '@codemirror/state';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { syncAnnotation } from '../editorBridge/syncAnnotation';
import { triggerOpenCellRequestEffect } from '../tableRuntime/openCellRequest';
import {
    classifyTableRuntimeFacts,
    type TableRuntimeExternalFacts,
} from '../tableRuntime/lifecycle/runtimeEventClassifier';
import { normalizeBeforeEditAnnotation } from '../tableRuntime/tableCanonicalForm';
import { activeCellField, setActiveCellEffect, type ActiveCell } from '../tableState/activeCellState';
import { cellSelectionTransitionAnnotation } from '../tableState/cellSelectionState';
import { activateInsertedTableEffect } from '../tableState/insertedTableActivation';
import { searchForceSourceModeField, setSearchForceSourceModeEffect } from '../tableState/searchForceSourceMode';
import { sourceModeField, toggleSourceModeEffect } from '../tableState/sourceMode';
import { createMarkdownState } from './testMarkdownState';

const TABLE_DOC = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
const DOC_WITH_SURROUNDING_TEXT = ['before', '', TABLE_DOC, '', 'after'].join('\n');
const SURROUNDING_TABLE_FROM = 'before\n\n'.length;

const DEFAULT_EXTERNAL_FACTS: TableRuntimeExternalFacts = {
    nestedEditorOpen: false,
    pendingFullReplaceRebuild: false,
};

function getHeaderCell(tableFrom = 0): ActiveCell {
    return {
        tableFrom,
        section: 'header',
        row: 0,
        col: 0,
    };
}

function dispatchAndCaptureUpdate(params: {
    dispatch: (view: EditorView) => void;
    doc?: string;
    activeCell?: ActiveCell | null;
    extensions?: Extension[];
}): ViewUpdate {
    let captured: ViewUpdate | null = null;
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    let state = createMarkdownState(params.doc ?? TABLE_DOC, [
        activeCellField,
        sourceModeField,
        searchForceSourceModeField,
        EditorView.updateListener.of((update) => {
            if (update.transactions.length > 0) {
                captured = update;
            }
        }),
        ...(params.extensions ?? []),
    ]);

    if (params.activeCell) {
        state = state.update({ effects: setActiveCellEffect.of(params.activeCell) }).state;
    }

    const view = new EditorView({ parent, state });
    params.dispatch(view);

    view.destroy();
    parent.remove();

    expect(captured).not.toBeNull();
    if (!captured) {
        throw new Error('Expected dispatch to produce a ViewUpdate');
    }

    return captured;
}

describe('runtimeEventClassifier', () => {
    it('distinguishes absent and unresolved active cells', () => {
        const absentUpdate = dispatchAndCaptureUpdate({
            doc: DOC_WITH_SURROUNDING_TEXT,
            dispatch(view) {
                view.dispatch({ selection: { anchor: 1 } });
            },
        });
        // Anchored inside the document but outside any table, so the cell is present
        // yet unresolvable — independent of how out-of-document anchors are handled.
        const unresolvedUpdate = dispatchAndCaptureUpdate({
            doc: DOC_WITH_SURROUNDING_TEXT,
            activeCell: getHeaderCell(DOC_WITH_SURROUNDING_TEXT.indexOf('after')),
            dispatch(view) {
                view.dispatch({ selection: { anchor: 1 } });
            },
        });

        expect(classifyTableRuntimeFacts(absentUpdate, DEFAULT_EXTERNAL_FACTS).activeCell).toEqual({
            status: 'absent',
        });
        expect(classifyTableRuntimeFacts(unresolvedUpdate, DEFAULT_EXTERNAL_FACTS).activeCell).toEqual({
            status: 'unresolved',
        });
    });

    it('classifies current state and external runtime flags', () => {
        const externalFacts: TableRuntimeExternalFacts = {
            ...DEFAULT_EXTERNAL_FACTS,
            nestedEditorOpen: true,
            pendingFullReplaceRebuild: true,
        };
        const update = dispatchAndCaptureUpdate({
            activeCell: getHeaderCell(),
            dispatch(view) {
                view.dispatch({ selection: { anchor: 3 } });
            },
        });

        expect(classifyTableRuntimeFacts(update, externalFacts)).toEqual({
            activeCell: { status: 'resolved', selectionLeftActiveTable: false },
            activeCellBefore: 'resolved',
            activeCellIdentityUnchanged: true,
            cellDragInProgress: false,
            effectiveRawMode: false,
            nestedEditorOpen: true,
            pendingFullReplaceRebuild: true,
            docChanged: false,
            selectionChanged: true,
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
        });
    });

    it('classifies annotations, raw mode entry, and the latest open request id', () => {
        const update = dispatchAndCaptureUpdate({
            activeCell: getHeaderCell(),
            dispatch(view) {
                view.dispatch({
                    effects: [
                        toggleSourceModeEffect.of(true),
                        setSearchForceSourceModeEffect.of(true),
                        triggerOpenCellRequestEffect.of({ requestId: 'first-request' }),
                        triggerOpenCellRequestEffect.of({ requestId: 'latest-request' }),
                    ],
                    annotations: [normalizeBeforeEditAnnotation.of(true), cellSelectionTransitionAnnotation.of(true)],
                });
            },
        });
        const facts = classifyTableRuntimeFacts(update, DEFAULT_EXTERNAL_FACTS);

        expect(facts.isNormalizeBeforeEdit).toBe(true);
        expect(facts.isCellSelectionTransition).toBe(true);
        expect(facts.hasInsertedTableActivation).toBe(false);
        expect(facts.openRequestId).toBe('latest-request');
        expect(facts.rawModeTransition).toEqual({
            enteredRawMode: true,
            exitedRawMode: false,
            exitedSourceMode: false,
            exitedSearchForce: false,
        });
    });

    it('classifies inserted-table activation effects', () => {
        const update = dispatchAndCaptureUpdate({
            dispatch(view) {
                view.dispatch({
                    effects: activateInsertedTableEffect.of({
                        tableFrom: 0,
                        target: { section: 'header', row: 0, col: 0 },
                    }),
                });
            },
        });
        const facts = classifyTableRuntimeFacts(update, DEFAULT_EXTERNAL_FACTS);

        expect(facts.hasInsertedTableActivation).toBe(true);
    });

    it('classifies raw mode exit from the update start state', () => {
        const update = dispatchAndCaptureUpdate({
            dispatch(view) {
                view.dispatch({ effects: toggleSourceModeEffect.of(true) });
                view.dispatch({ effects: toggleSourceModeEffect.of(false) });
            },
        });
        const facts = classifyTableRuntimeFacts(update, DEFAULT_EXTERNAL_FACTS);

        expect(facts.rawModeTransition).toEqual({
            enteredRawMode: false,
            exitedRawMode: true,
            exitedSourceMode: false,
            exitedSearchForce: false,
        });
    });

    it('classifies same-cell selection facts needed for nested sync work', () => {
        const externalFacts: TableRuntimeExternalFacts = {
            ...DEFAULT_EXTERNAL_FACTS,
            nestedEditorOpen: true,
        };
        const update = dispatchAndCaptureUpdate({
            activeCell: getHeaderCell(),
            dispatch(view) {
                view.dispatch({ selection: { anchor: 4 } });
            },
        });
        const facts = classifyTableRuntimeFacts(update, externalFacts);

        expect(facts.selectionChanged).toBe(true);
        expect(facts.isSync).toBe(false);
        expect(facts.activeCellIdentityUnchanged).toBe(true);
    });

    it('classifies sync-annotated selection updates as sync updates', () => {
        const externalFacts: TableRuntimeExternalFacts = {
            ...DEFAULT_EXTERNAL_FACTS,
            nestedEditorOpen: true,
        };
        const update = dispatchAndCaptureUpdate({
            activeCell: getHeaderCell(),
            dispatch(view) {
                view.dispatch({
                    selection: { anchor: 4 },
                    annotations: syncAnnotation.of(true),
                });
            },
        });
        const facts = classifyTableRuntimeFacts(update, externalFacts);

        expect(facts.isSync).toBe(true);
        expect(facts.activeCellIdentityUnchanged).toBe(true);
    });

    it('detects when selection leaves the resolved active table', () => {
        const externalFacts: TableRuntimeExternalFacts = {
            ...DEFAULT_EXTERNAL_FACTS,
            nestedEditorOpen: true,
        };
        const update = dispatchAndCaptureUpdate({
            doc: DOC_WITH_SURROUNDING_TEXT,
            activeCell: getHeaderCell(SURROUNDING_TABLE_FROM),
            dispatch(view) {
                view.dispatch({ selection: { anchor: 0 } });
            },
        });
        const facts = classifyTableRuntimeFacts(update, externalFacts);

        expect(facts.activeCell).toEqual({ status: 'resolved', selectionLeftActiveTable: true });
    });

    it('detects redo edits outside the active cell as reposition events', () => {
        const update = dispatchAndCaptureUpdate({
            activeCell: getHeaderCell(),
            dispatch(view) {
                view.dispatch({
                    changes: { from: 0, to: 0, insert: 'note\n' },
                    annotations: Transaction.userEvent.of('redo'),
                });
            },
        });
        const facts = classifyTableRuntimeFacts(update, DEFAULT_EXTERNAL_FACTS);

        expect(facts.docChanged).toBe(true);
        expect(facts.activeCellBefore).toBe('resolved');
        expect(facts.rebuildTouchesPreviousActiveTable).toBe(true);
        expect(facts.isUndoRedoInsideTable).toBe(false);
    });

    it('classifies undo or redo inside a table independently of policy gates', () => {
        const update = dispatchAndCaptureUpdate({
            dispatch(view) {
                view.dispatch({
                    changes: { from: 3, to: 3, insert: 'x' },
                    annotations: [Transaction.userEvent.of('undo'), syncAnnotation.of(true)],
                });
            },
        });
        const facts = classifyTableRuntimeFacts(update, DEFAULT_EXTERNAL_FACTS);

        expect(facts.docChanged).toBe(true);
        expect(facts.isSync).toBe(true);
        expect(facts.isUndoRedoInsideTable).toBe(true);
    });

    it('produces coherent facts when a sync update carries several signals', () => {
        const update = dispatchAndCaptureUpdate({
            activeCell: getHeaderCell(),
            dispatch(view) {
                view.dispatch({
                    selection: { anchor: 4 },
                    effects: activateInsertedTableEffect.of({
                        tableFrom: 0,
                        target: { section: 'header', row: 0, col: 0 },
                    }),
                    annotations: [syncAnnotation.of(true), cellSelectionTransitionAnnotation.of(true)],
                });
            },
        });

        const facts = classifyTableRuntimeFacts(update, {
            nestedEditorOpen: true,
            pendingFullReplaceRebuild: true,
        });

        expect(facts).toMatchObject({
            activeCell: { status: 'resolved', selectionLeftActiveTable: false },
            nestedEditorOpen: true,
            pendingFullReplaceRebuild: true,
            selectionChanged: true,
            isSync: true,
            isCellSelectionTransition: true,
            hasInsertedTableActivation: true,
            activeCellIdentityUnchanged: true,
            cellDragInProgress: false,
        });
    });
});
