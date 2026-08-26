import { EditorState, Prec, Transaction, type Extension, type TransactionSpec } from '@codemirror/state';
import { keymap, type EditorView } from '@codemirror/view';
import { getActiveCell } from '../../tableState/activeCellState';
import { getCellSelection } from '../../tableState/cellSelectionState';
import { isEffectiveRawMode } from '../../tableState/sourceMode';
import { getPendingOpenCellRequest } from '../openCellRequest';
import { resolveTableContextAtPos } from '../tableResolution';
import {
    buildWholeTableSelectionTransaction,
    selectWholeTable,
    type WholeTableSelectionFocus,
} from '../selection/cellSelectionController';

type DeletionDirection = 'backward' | 'forward';

// A rendered widget implies that table parsing has already completed. Keyboard
// entry must never block waiting for syntax work on the input event path.
const TABLE_ENTRY_SYNTAX_TREE_TIMEOUT_MS = 0;

interface PureDeletion {
    from: number;
    to: number;
}

function canEnterRenderedTable(state: EditorState): boolean {
    return (
        !isEffectiveRawMode(state) &&
        state.selection.ranges.length === 1 &&
        state.selection.main.empty &&
        !getCellSelection(state) &&
        !getActiveCell(state) &&
        !getPendingOpenCellRequest(state)
    );
}

function focusEdgeForDirection(direction: DeletionDirection): WholeTableSelectionFocus {
    return direction === 'backward' ? 'end' : 'start';
}

function selectTableAtCharacterTarget(view: EditorView, direction: DeletionDirection): boolean {
    if (!canEnterRenderedTable(view.state)) {
        return false;
    }

    const current = view.state.selection.main;
    const target = view.moveByChar(current, direction === 'forward');
    if (target.head === current.head) {
        return false;
    }

    const ctx = resolveTableContextAtPos(view.state, target.head, TABLE_ENTRY_SYNTAX_TREE_TIMEOUT_MS);
    if (!ctx) {
        return false;
    }

    return selectWholeTable(view, ctx, focusEdgeForDirection(direction));
}

function findSinglePureDeletion(transaction: Transaction): PureDeletion | null {
    let deletion: PureDeletion | null = null;
    let valid = true;

    transaction.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
        if (deletion || from === to || inserted.length > 0) {
            valid = false;
            return;
        }

        deletion = { from, to };
    });

    return valid ? deletion : null;
}

function inferDeletionDirection(transaction: Transaction, deletion: PureDeletion): DeletionDirection | null {
    const userEvent = transaction.annotation(Transaction.userEvent);
    if (userEvent === 'delete.backward') {
        return 'backward';
    }
    if (userEvent === 'delete.forward') {
        return 'forward';
    }
    if (userEvent !== 'input.type') {
        return null;
    }

    const caret = transaction.startState.selection.main.head;
    if (deletion.to === caret && deletion.from < caret) {
        return 'backward';
    }
    if (deletion.from === caret && deletion.to > caret) {
        return 'forward';
    }

    return null;
}

function rewriteTableBoundaryDeletion(transaction: Transaction): TransactionSpec | Transaction {
    if (!transaction.docChanged || !canEnterRenderedTable(transaction.startState)) {
        return transaction;
    }

    const deletion = findSinglePureDeletion(transaction);
    if (!deletion) {
        return transaction;
    }

    const direction = inferDeletionDirection(transaction, deletion);
    if (!direction) {
        return transaction;
    }

    const targetPos = direction === 'backward' ? deletion.from : deletion.to;
    const ctx = resolveTableContextAtPos(transaction.startState, targetPos, TABLE_ENTRY_SYNTAX_TREE_TIMEOUT_MS);
    if (!ctx) {
        return transaction;
    }

    return buildWholeTableSelectionTransaction(ctx, focusEdgeForDirection(direction)) ?? transaction;
}

const tableBoundaryDeletionFilter = EditorState.transactionFilter.of(rewriteTableBoundaryDeletion);

const tableBoundaryDeletionKeymap = Prec.highest(
    keymap.of([
        {
            key: 'Backspace',
            run: (view) => selectTableAtCharacterTarget(view, 'backward'),
        },
        {
            key: 'Delete',
            run: (view) => selectTableAtCharacterTarget(view, 'forward'),
        },
    ])
);

export const mainEditorTableEntryExtension: Extension = [tableBoundaryDeletionFilter, tableBoundaryDeletionKeymap];
