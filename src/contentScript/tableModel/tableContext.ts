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
import type { SyntaxNode } from '@lezer/common';
import type { TableGridBounds } from './types';

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

/**
 * Builds a TableContext for a root table node and its exact source text.
 * Returns null only for a node arrangement the syntax projection rejects.
 */
export function buildTableContext(node: SyntaxNode, text: string): TableContext | null {
    const syntax = extractRootMarkdownTableSyntax(node, text);
    if (!syntax) return null;

    return {
        from: node.from,
        to: node.to,
        text,
        table: MarkdownTable.fromSyntax(text, syntax),
        cellRanges: computeMarkdownTableCellRangesFromSyntax(text, syntax),
    };
}
