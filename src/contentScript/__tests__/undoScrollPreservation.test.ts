import { markdown } from '@codemirror/lang-markdown';
import { StateField, type StateEffect, type Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import { vi, type Mock } from 'vitest';
import { activeCellField, setActiveCellEffect, type ActiveCell } from '../tableState/activeCellState';
import { tableContextField } from '../tableState/tableContextField';
import { createUndoScrollPreservation } from '../tableRuntime/undoScrollPreservation';
import { isNestedEditorOpen } from '../nestedEditor/nestedEditorController';

vi.mock('../nestedEditor/nestedEditorController', () => ({
    isNestedEditorOpen: vi.fn(),
}));

const markdownExtension = markdown({
    extensions: [GFM],
});

const TABLE_DOC = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
const mockIsNestedEditorOpen = isNestedEditorOpen as Mock;

interface UndoHarness {
    view: EditorView;
    /** Effects carried by every transaction dispatched after setup. */
    dispatchedEffects: () => readonly StateEffect<unknown>[];
    stateFieldUpdateCount: () => number;
}

function createHarness(activeCell: ActiveCell): UndoHarness {
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const transactions: Transaction[] = [];
    let stateFieldUpdates = 0;
    const probeField = StateField.define({
        create: () => 0,
        update: (value) => {
            stateFieldUpdates++;
            return value + 1;
        },
    });
    let view: EditorView;
    view = new EditorView({
        parent,
        extensions: [
            markdownExtension,
            tableContextField,
            activeCellField,
            probeField,
            createUndoScrollPreservation(() => view),
            EditorView.updateListener.of((update) => transactions.push(...update.transactions)),
        ],
        doc: TABLE_DOC,
    });
    view.dispatch({
        effects: setActiveCellEffect.of(activeCell),
    });
    // Only the transactions under test matter; drop the ones that staged the active cell.
    transactions.length = 0;
    stateFieldUpdates = 0;

    return {
        view,
        dispatchedEffects: () => transactions.flatMap((transaction) => [...transaction.effects]),
        stateFieldUpdateCount: () => stateFieldUpdates,
    };
}

function dispatchUndoEdit(view: EditorView): void {
    const from = view.state.doc.toString().indexOf('a1');
    view.dispatch({
        changes: {
            from,
            to: from + 2,
            insert: 'a',
        },
        userEvent: 'undo',
    });
}

/**
 * `EditorView.scrollSnapshot()` produces a `ScrollTarget` flagged `isSnapshot`, distinguishing
 * a restore-the-viewport effect from an ordinary `scrollIntoView` request. The effect type
 * itself is not exported, so the flag is the observable marker available to a test.
 */
function isScrollSnapshotEffect(effect: StateEffect<unknown>): boolean {
    const value = effect.value;
    return typeof value === 'object' && value !== null && (value as { isSnapshot?: unknown }).isSnapshot === true;
}

describe('createUndoScrollPreservation', () => {
    beforeEach(() => {
        mockIsNestedEditorOpen.mockReset();
        mockIsNestedEditorOpen.mockReturnValue(true);
    });

    it('carries a scroll snapshot on undo in a resolved active cell', () => {
        const { view, dispatchedEffects } = createHarness({
            tableFrom: 0,
            section: 'body',
            row: 0,
            col: 0,
        });

        dispatchUndoEdit(view);

        expect(dispatchedEffects().filter(isScrollSnapshotEffect)).toHaveLength(1);

        view.destroy();
    });

    it('constructs the post-undo state exactly once when adding a scroll snapshot', () => {
        const { view, stateFieldUpdateCount } = createHarness({
            tableFrom: 0,
            section: 'body',
            row: 0,
            col: 0,
        });

        dispatchUndoEdit(view);

        expect(stateFieldUpdateCount()).toBe(1);
        view.destroy();
    });

    it('does not carry a scroll snapshot when the active cell no longer resolves', () => {
        const { view, dispatchedEffects } = createHarness({
            tableFrom: 0,
            section: 'body',
            row: 0,
            col: 99,
        });

        dispatchUndoEdit(view);

        expect(dispatchedEffects().some(isScrollSnapshotEffect)).toBe(false);

        view.destroy();
    });
});
