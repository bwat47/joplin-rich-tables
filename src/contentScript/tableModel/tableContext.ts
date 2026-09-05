/**
 * TableContext: a single derived object that bundles a table's document span,
 * parsed MarkdownTable, and computed cell ranges.
 *
 * Eliminates the repeated resolveTable → parse → computeCellRanges chain
 * that was independently performed across commands, interactions, navigation,
 * and the widget extension.
 */
import { MarkdownTable } from './MarkdownTable';
import { extractRootMarkdownTableSyntax } from './lezerTableSyntax';
import { computeMarkdownTableCellRangesFromSyntax, type TableCellRanges } from './markdownTableCellRanges';
import type { ResolvedTable, TableGridBounds } from './types';

export interface TableContext {
    from: number;
    to: number;
    text: string;
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

/** Keyed by the table's exact source text, which determines every derived value below. */
const tableContextCache = new Map<string, CacheEntry>();
const MAX_CACHE_SIZE = 50;

/**
 * Builds a TableContext for a resolved table, given its exact source text.
 *
 * This is the single cache for the whole derivation: syntax extraction, the normalized
 * model, and cell ranges all hang off one LRU keyed by that text. Returns null only for
 * a node arrangement the syntax projection rejects.
 */
export function buildTableContext(resolved: ResolvedTable, text: string): TableContext | null {
    const { from, to } = resolved;
    let entry = tableContextCache.get(text);

    if (entry) {
        // LRU refresh: move to end of Map
        tableContextCache.delete(text);
        tableContextCache.set(text, entry);
    } else {
        const syntax = extractRootMarkdownTableSyntax(resolved.node, text);
        if (!syntax) return null;

        entry = {
            table: MarkdownTable.fromSyntax(text, syntax),
            cellRanges: computeMarkdownTableCellRangesFromSyntax(text, syntax),
        };

        if (tableContextCache.size >= MAX_CACHE_SIZE) {
            const firstKey = tableContextCache.keys().next().value;
            if (firstKey !== undefined) tableContextCache.delete(firstKey);
        }
        tableContextCache.set(text, entry);
    }

    return { from, to, text, table: entry.table, cellRanges: entry.cellRanges };
}
