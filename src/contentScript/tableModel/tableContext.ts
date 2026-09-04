/**
 * TableContext: a single derived object that bundles a table's document span,
 * parsed MarkdownTable, and computed cell ranges.
 *
 * Eliminates the repeated resolveTable → parse → computeCellRanges chain
 * that was independently performed across commands, interactions, navigation,
 * and the widget extension.
 */
import { MarkdownTable } from './MarkdownTable';
import { computeMarkdownTableCellRangesFromSyntax, type TableCellRanges } from './markdownTableCellRanges';
import type { ResolvedTable, TableGridBounds } from './types';

export interface TableContext extends ResolvedTable {
    table: MarkdownTable;
    cellRanges: TableCellRanges;
}

/** The header occupies unified row 0, so it contributes one row to the grid. */
const HEADER_ROW_COUNT = 1;

/** Grid size in unified coordinates; column count is taken from the header row. */
export function getTableGridBounds(ctx: TableContext): TableGridBounds {
    return {
        totalRows: HEADER_ROW_COUNT + ctx.cellRanges.rows.length,
        totalCols: ctx.cellRanges.headers.length,
    };
}

interface CacheEntry {
    table: MarkdownTable;
    cellRanges: TableCellRanges;
}

/** Keyed by the table's exact source text. */
const tableContextCache = new Map<string, CacheEntry>();
const MAX_CACHE_SIZE = 50;

/**
 * Builds a TableContext from a resolved table range.
 * Uses an LRU cache keyed by the table's source text so repeated lookups
 * for the same table content skip parsing and range computation.
 */
export function buildTableContext(resolved: ResolvedTable): TableContext | null {
    const { from, to, text, syntax } = resolved;
    let entry = tableContextCache.get(text);

    if (entry) {
        // LRU refresh: move to end of Map
        tableContextCache.delete(text);
        tableContextCache.set(text, entry);
    } else {
        const table = MarkdownTable.fromSyntax(text, syntax);
        const cellRanges = computeMarkdownTableCellRangesFromSyntax(text, syntax);

        entry = { table, cellRanges };

        if (tableContextCache.size >= MAX_CACHE_SIZE) {
            const firstKey = tableContextCache.keys().next().value;
            if (firstKey !== undefined) tableContextCache.delete(firstKey);
        }
        tableContextCache.set(text, entry);
    }

    return { from, to, text, syntax, table: entry.table, cellRanges: entry.cellRanges };
}
