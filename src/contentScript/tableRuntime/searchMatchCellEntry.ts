/**
 * Opens the table cell a find next/previous command selects a match in.
 *
 * With the search panel open, tables render as raw Markdown and matches select visible source.
 * Find next/previous (F3, Mod-g) also run with the panel closed, while tables are rendered, and
 * would otherwise select source hidden behind a widget. The entry rides the search transaction
 * and adopts its selection, so the nested editor mirrors the match when it mounts.
 */
import { EditorState, Transaction, type Extension } from '@codemirror/state';
import { getActiveCell, isSameActiveCell } from '../tableState/activeCellState';
import { getTableContextAtPos } from '../tableState/tableContextField';
import { isEffectiveRawMode } from '../tableState/sourceMode';
import { findCellForPos } from '../tableModel/markdownTableCellRanges';
import { createResolvedActiveCell, type ResolvedActiveCell } from './activeCell/resolvedActiveCell';
import { prepareOpenCellRequestTransaction } from './openCellRequest';

/** User event `findNext` and `findPrevious` dispatch; select-all-matches uses a sub-event. */
const FIND_MATCH_USER_EVENT = 'select.search';

/**
 * The rendered cell whose editable text holds the whole match a find command selected, or null
 * when the transaction is not such a match.
 *
 * A match reaching past its cell (across a pipe, or into the delimiter row) has no cell to show
 * it in, so it is left to the whole-table selection snap.
 */
export function resolveSearchMatchCell(tr: Transaction): ResolvedActiveCell | null {
    if (tr.docChanged || !tr.selection || tr.annotation(Transaction.userEvent) !== FIND_MATCH_USER_EVENT) {
        return null;
    }
    if (isEffectiveRawMode(tr.startState)) {
        return null;
    }

    const match = tr.selection.main;
    const ctx = getTableContextAtPos(tr.startState, match.from);
    const coords = ctx ? findCellForPos(ctx.cellRanges, match.from - ctx.from) : null;
    if (!ctx || !coords) {
        return null;
    }

    const resolvedCell = createResolvedActiveCell({ ctx, coords });
    return resolvedCell && match.to <= resolvedCell.editableTo ? resolvedCell : null;
}

/**
 * Attaches an entry into the matched cell to the find transaction. A match in the cell already
 * being edited needs no entry: the lifecycle syncs the new selection into the open editor.
 */
export const searchMatchCellEntryExtension: Extension = EditorState.transactionExtender.of((tr) => {
    const resolvedCell = resolveSearchMatchCell(tr);
    if (!resolvedCell || isSameActiveCell(getActiveCell(tr.startState), resolvedCell.activeCell)) {
        return null;
    }

    const { effects } = prepareOpenCellRequestTransaction({
        state: tr.startState,
        resolvedCell,
        entryMode: 'adopt',
        suppressKeys: true,
    });
    return { effects };
});
