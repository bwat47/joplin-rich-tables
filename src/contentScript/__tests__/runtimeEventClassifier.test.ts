import { Compartment, type Extension, StateEffect, Transaction } from '@codemirror/state';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { syncAnnotation } from '../editorBridge/syncAnnotation';
import { triggerOpenCellRequestEffect } from '../tableRuntime/openCellRequest';
import {
    classifyTableRuntimeFacts,
    type TableRuntimeExternalFacts,
} from '../tableRuntime/lifecycle/runtimeEventClassifier';
import { activeCellField, setActiveCellEffect, type ActiveCell } from '../tableState/activeCellState';
import { cellSelectionTransitionAnnotation } from '../tableState/cellSelectionState';
import { searchForceSourceModeField, setSearchForceSourceModeEffect } from '../tableState/searchForceSourceMode';
import { sourceModeField, toggleSourceModeEffect } from '../tableState/sourceMode';
import { createMarkdownState } from './testMarkdownState';
import { tableDecorationField } from '../tableWidget/tableDecorationField';
import { noteIdentityFacet } from '../services/noteIdentity';
import { requireResolvedActiveCell } from './testUtils';
import { createResizeObserverStub } from './tableEditorFixtures';

const resizeObserver = createResizeObserverStub();

const TABLE_DOC = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
const DOC_WITH_SURROUNDING_TEXT = ['before', '', TABLE_DOC, '', 'after'].join('\n');
const SURROUNDING_TABLE_FROM = 'before\n\n'.length;

const DEFAULT_EXTERNAL_FACTS: TableRuntimeExternalFacts = {
    nestedEditorOpen: false,
};

beforeAll(() => {
    resizeObserver.install();
});

afterAll(() => {
    vi.unstubAllGlobals();
});

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
        tableDecorationField,
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
        };
        const update = dispatchAndCaptureUpdate({
            activeCell: getHeaderCell(),
            dispatch(view) {
                view.dispatch({ selection: { anchor: 3 } });
            },
        });

        expect(classifyTableRuntimeFacts(update, externalFacts)).toEqual({
            activeCell: {
                status: 'resolved',
                resolvedCell: requireResolvedActiveCell(update.state),
                selectionLeftActiveTable: false,
            },
            activeCellBefore: 'resolved',
            activeCellIdentityUnchanged: true,
            cellDragInProgress: false,
            effectiveRawMode: false,
            nestedEditorOpen: true,
            docChanged: false,
            selectionChanged: true,
            isSync: false,
            isCellSelectionTransition: false,
            rawModeTransition: {
                enteredRawMode: false,
                exitedRawMode: false,
                exitedSourceMode: false,
                exitedSearchForce: false,
            },
            activeHostInvalidated: false,
            isUndoRedoInsideTable: false,
            openRequestId: null,
            noteChanged: false,
        });
    });

    it('classifies a note ID change as a note switch', () => {
        const noteConfiguration = new Compartment();
        const update = dispatchAndCaptureUpdate({
            extensions: [noteConfiguration.of(noteIdentityFacet.of('note-a'))],
            dispatch(view) {
                view.dispatch({ effects: noteConfiguration.reconfigure(noteIdentityFacet.of('note-b')) });
            },
        });

        expect(classifyTableRuntimeFacts(update, DEFAULT_EXTERNAL_FACTS).noteChanged).toBe(true);
    });

    it('does not classify an unchanged note ID as a note switch', () => {
        const update = dispatchAndCaptureUpdate({
            extensions: [noteIdentityFacet.of('note-a')],
            dispatch(view) {
                view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: TABLE_DOC } });
            },
        });

        expect(classifyTableRuntimeFacts(update, DEFAULT_EXTERNAL_FACTS).noteChanged).toBe(false);
    });

    it('does not classify the first note ID registration as a note switch', () => {
        const update = dispatchAndCaptureUpdate({
            dispatch(view) {
                view.dispatch({ effects: StateEffect.appendConfig.of(noteIdentityFacet.of('note-a')) });
            },
        });

        expect(classifyTableRuntimeFacts(update, DEFAULT_EXTERNAL_FACTS).noteChanged).toBe(false);
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
                    annotations: cellSelectionTransitionAnnotation.of(true),
                });
            },
        });
        const facts = classifyTableRuntimeFacts(update, DEFAULT_EXTERNAL_FACTS);

        expect(facts.isCellSelectionTransition).toBe(true);
        expect(facts.openRequestId).toBe('latest-request');
        expect(facts.rawModeTransition).toEqual({
            enteredRawMode: true,
            exitedRawMode: false,
            exitedSourceMode: false,
            exitedSearchForce: false,
        });
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

        expect(facts.activeCell).toEqual({
            status: 'resolved',
            resolvedCell: requireResolvedActiveCell(update.state),
            selectionLeftActiveTable: true,
        });
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
        expect(facts.activeHostInvalidated).toBe(true);
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
});
