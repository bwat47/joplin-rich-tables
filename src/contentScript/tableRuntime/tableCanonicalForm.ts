import { Annotation } from '@codemirror/state';
import type { EditorState } from '@codemirror/state';
import type { TableContext } from '../tableModel/tableContext';
import type { CellCoords } from '../tableModel/types';
import { createActiveCellForTableText, type ActiveCellSelectionTarget } from './activeCell/activeCellFactory';
import {
    countLeadingBlankLinesAfterBoundary,
    countTrailingBlankLinesBeforeBoundary,
    REQUIRED_TABLE_BOUNDARY_BLANK_LINES,
} from './tableBoundarySpacing';

/**
 * Marks a transaction that rewrites a table into canonical form as part of entering it.
 * Widget and guard policies use it to tell that rewrite apart from a user edit.
 */
export const normalizeBeforeEditAnnotation = Annotation.define<boolean>();

interface NormalizedTableReplacement {
    /** Document range `insert` replaces. */
    from: number;
    to: number;
    insert: string;
    tableText: string;
    tableFrom: number;
}

interface TableBoundaryPadding {
    prefix: string;
    suffix: string;
}

/** Canonical-form repair to fold into the transaction that enters a cell. */
export interface CellEntryNormalization {
    changes: { from: number; to: number; insert: string };
    /** Where the entered cell lands once the replacement is applied. */
    target: ActiveCellSelectionTarget;
}

/**
 * Blank-line padding the table needs to stay separated from its surroundings.
 * A single newline per side is enough: the replaced range is line-bounded, so the
 * neighbouring line breaks already outside it combine with the padding to form the blank line.
 *
 * Document edges count as unseparated, so a table at the very start or end of the note is
 * padded too. That is intended: a table flush against the document start is kept off the
 * first line so there is always a newline before it.
 */
function resolveBoundaryPadding(state: EditorState, ctx: Pick<TableContext, 'from' | 'to'>): TableBoundaryPadding {
    const beforeText = state.doc.sliceString(0, ctx.from);
    const afterText = state.doc.sliceString(ctx.to);
    const needsLeadingSeparator =
        countTrailingBlankLinesBeforeBoundary(beforeText) < REQUIRED_TABLE_BOUNDARY_BLANK_LINES;
    const needsTrailingSeparator = countLeadingBlankLinesAfterBoundary(afterText) < REQUIRED_TABLE_BOUNDARY_BLANK_LINES;

    return {
        prefix: needsLeadingSeparator ? '\n' : '',
        suffix: needsTrailingSeparator ? '\n' : '',
    };
}

/**
 * Returns canonical table markdown plus missing blank-line boundaries when needed.
 * The table serializer stays table-only; boundary spacing depends on document context.
 */
function getNormalizedTableReplacementIfChanged(
    state: EditorState,
    ctx: Pick<TableContext, 'from' | 'to' | 'table' | 'text'>
): NormalizedTableReplacement | null {
    const tableText = ctx.table.serialize();
    const { prefix, suffix } = resolveBoundaryPadding(state, ctx);
    const insert = prefix + tableText + suffix;

    if (insert === ctx.text) {
        return null;
    }

    return {
        from: ctx.from,
        to: ctx.to,
        insert,
        tableText,
        tableFrom: ctx.from + prefix.length,
    };
}

/**
 * Normalization to apply in the same transaction that enters `coords`, or null when the
 * table is already canonical or `coords` cannot be mapped into the repaired text.
 *
 * Entry transactions are dispatched from the event that triggered them, so folding the
 * repair in keeps the document change on that event. Repairing a frame later instead
 * leaves the host holding a note body the editor has already moved past, which it then
 * writes back over the newer document.
 */
export function planCellEntryNormalization(params: {
    state: EditorState;
    ctx: Pick<TableContext, 'from' | 'to' | 'table' | 'text'>;
    coords: CellCoords;
}): CellEntryNormalization | null {
    const replacement = getNormalizedTableReplacementIfChanged(params.state, params.ctx);
    if (!replacement) {
        return null;
    }

    const target = createActiveCellForTableText({
        tableFrom: replacement.tableFrom,
        tableText: replacement.tableText,
        target: params.coords,
    });
    // Dropping the repair keeps the entry alive: the cell still opens, against the table as it
    // stands. `serialize()` widens rows rather than dropping columns, so a source-backed cell
    // always maps - this is a guard, not an expected path.
    if (!target) {
        return null;
    }

    return {
        changes: { from: replacement.from, to: replacement.to, insert: replacement.insert },
        target,
    };
}
