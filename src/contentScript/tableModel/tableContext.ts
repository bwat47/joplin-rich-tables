/**
 * TableContext: a single derived object that bundles a table's document span,
 * parsed MarkdownTable, and computed cell ranges.
 *
 * Eliminates the repeated resolveTable → parse → computeCellRanges chain
 * that was independently performed across commands, interactions, navigation,
 * and the widget extension.
 */
import { MarkdownTable } from './MarkdownTable';
import { computeMarkdownTableCellRanges, type TableCellRanges } from './markdownTableCellRanges';
import type { ResolvedTable } from './types';

export interface TableContext extends ResolvedTable {
    table: MarkdownTable;
    cellRanges: TableCellRanges;
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
    const { from, to, text } = resolved;
    let entry = tableContextCache.get(text);

    if (entry) {
        // LRU refresh: move to end of Map
        tableContextCache.delete(text);
        tableContextCache.set(text, entry);
    } else {
        const table = MarkdownTable.parse(text);
        if (!table) return null;

        const cellRanges = computeMarkdownTableCellRanges(text);
        if (!cellRanges) return null;

        entry = { table, cellRanges };

        if (tableContextCache.size >= MAX_CACHE_SIZE) {
            const firstKey = tableContextCache.keys().next().value;
            if (firstKey !== undefined) tableContextCache.delete(firstKey);
        }
        tableContextCache.set(text, entry);
    }

    return { from, to, text, table: entry.table, cellRanges: entry.cellRanges };
}
