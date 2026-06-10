/**
 * @jest-environment jsdom
 */

import { type Extension, Transaction } from '@codemirror/state';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import { describe, expect, it } from '@jest/globals';
import { syncAnnotation } from '../editorBridge/syncAnnotation';
import { triggerOpenCellRequestEffect } from '../tableRuntime/openCellRequest';
import {
    classifyTableRuntimeEvent,
    createTableRuntimeSnapshot,
    type TableRuntimeExternalFacts,
} from '../tableRuntime/lifecycle/runtimeEventClassifier';
import { normalizeBeforeEditAnnotation } from '../tableRuntime/lifecycle/tableNormalization';
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
    it('creates a runtime snapshot from current state and previous runtime flags', () => {
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

        expect(createTableRuntimeSnapshot(update, externalFacts)).toEqual({
            hasActiveCell: true,
            currentActiveCellResolved: true,
            effectiveRawMode: false,
            nestedEditorOpen: true,
            hadActiveCellBeforeUpdate: true,
            pendingFullReplaceRebuild: true,
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
        const snapshot = createTableRuntimeSnapshot(update, DEFAULT_EXTERNAL_FACTS);
        const event = classifyTableRuntimeEvent(update, snapshot);

        expect(event.isNormalizeBeforeEdit).toBe(true);
        expect(event.isCellSelectionTransition).toBe(true);
        expect(event.hasInsertedTableActivation).toBe(false);
        expect(event.openRequestId).toBe('latest-request');
        expect(event.rawModeTransition).toEqual({
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
        const snapshot = createTableRuntimeSnapshot(update, DEFAULT_EXTERNAL_FACTS);
        const event = classifyTableRuntimeEvent(update, snapshot);

        expect(event.hasInsertedTableActivation).toBe(true);
    });

    it('classifies raw mode exit from the update start state', () => {
        const update = dispatchAndCaptureUpdate({
            dispatch(view) {
                view.dispatch({ effects: toggleSourceModeEffect.of(true) });
                view.dispatch({ effects: toggleSourceModeEffect.of(false) });
            },
        });
        const snapshot = createTableRuntimeSnapshot(update, DEFAULT_EXTERNAL_FACTS);
        const event = classifyTableRuntimeEvent(update, snapshot);

        expect(event.rawModeTransition).toEqual({
            enteredRawMode: false,
            exitedRawMode: true,
            exitedSourceMode: false,
            exitedSearchForce: false,
        });
    });

    it('classifies same-cell selection updates as nested sync work', () => {
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
        const snapshot = createTableRuntimeSnapshot(update, externalFacts);
        const event = classifyTableRuntimeEvent(update, snapshot);

        expect(event.selectionChanged).toBe(true);
        expect(event.isSync).toBe(false);
        expect(event.shouldSyncMainToNested).toBe(true);
    });

    it('does not request nested sync for sync-annotated selection updates', () => {
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
        const snapshot = createTableRuntimeSnapshot(update, externalFacts);
        const event = classifyTableRuntimeEvent(update, snapshot);

        expect(event.isSync).toBe(true);
        expect(event.shouldSyncMainToNested).toBe(false);
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
        const snapshot = createTableRuntimeSnapshot(update, externalFacts);
        const event = classifyTableRuntimeEvent(update, snapshot);

        expect(event.selectionLeftActiveTable).toBe(true);
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
        const snapshot = createTableRuntimeSnapshot(update, DEFAULT_EXTERNAL_FACTS);
        const event = classifyTableRuntimeEvent(update, snapshot);

        expect(event.docChanged).toBe(true);
        expect(event.requiresCellReposition).toBe(true);
    });
});
