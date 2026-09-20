import { Annotation } from '@codemirror/state';
import type { EditorState } from '@codemirror/state';
import type { SerializedTable } from '../tableModel/MarkdownTable';
import type { TableContext } from '../tableModel/tableContext';
import type { CellCoords } from '../tableModel/types';
import { createActiveCellForTable, type ActiveCellSelectionTarget } from './activeCell/activeCellFactory';
import { hasRequiredBlankLinesAfter, hasRequiredBlankLinesBefore } from './tableBoundarySpacing';

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
    tableFrom: number;
    /** The canonical table inside `insert`, carried so cells can be located in it. */
    serialized: SerializedTable;
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
 *
 * A table that does not start or end on a line boundary still needs a newline, even if a
 * blank line already sits above or below that line: the prefix/suffix is what splits the
 * merged neighbour off the table.
 */
function resolveBoundaryPadding(state: EditorState, ctx: Pick<TableContext, 'from' | 'to'>): TableBoundaryPadding {
    const { doc } = state;
    const needsLeadingSeparator = doc.lineAt(ctx.from).from !== ctx.from || !hasRequiredBlankLinesBefore(doc, ctx.from);
    const needsTrailingSeparator = doc.lineAt(ctx.to).to !== ctx.to || !hasRequiredBlankLinesAfter(doc, ctx.to);

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
    const serialized = ctx.table.serializeWithOffsets();
    const { prefix, suffix } = resolveBoundaryPadding(state, ctx);
    const insert = prefix + serialized.text + suffix;

    if (insert === ctx.text) {
        return null;
    }

    return {
        from: ctx.from,
        to: ctx.to,
        insert,
        tableFrom: ctx.from + prefix.length,
        serialized,
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

    const target = createActiveCellForTable({
        tableFrom: replacement.tableFrom,
        serialized: replacement.serialized,
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
