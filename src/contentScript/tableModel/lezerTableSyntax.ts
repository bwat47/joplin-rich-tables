import type { SyntaxNode } from '@lezer/common';
import { GFM, parser } from '@lezer/markdown';

export interface MarkdownTableSourceRange {
    readonly from: number;
    readonly to: number;
}

export interface MarkdownTableSyntaxCell {
    /** Cell bounds excluding pipe delimiters, relative to the table start. */
    readonly raw: MarkdownTableSourceRange;
    /** Lezer's non-whitespace TableCell bounds, or null for an empty cell. */
    readonly content: MarkdownTableSourceRange | null;
}

export interface MarkdownTableSyntaxRow extends MarkdownTableSourceRange {
    readonly cells: readonly MarkdownTableSyntaxCell[];
}

export interface MarkdownTableSyntax {
    readonly header: MarkdownTableSyntaxRow;
    readonly separator: MarkdownTableSourceRange;
    readonly bodyRows: readonly MarkdownTableSyntaxRow[];
}

export interface ParsedRootMarkdownTableSyntax extends MarkdownTableSourceRange {
    /** Syntax ranges rebased to `from`, so the table itself starts at offset zero. */
    readonly syntax: MarkdownTableSyntax;
}

const markdownTableParser = parser.configure([GFM]);

function toRelativeRange(node: Pick<SyntaxNode, 'from' | 'to'>, tableFrom: number): MarkdownTableSourceRange {
    return { from: node.from - tableFrom, to: node.to - tableFrom };
}

function buildRawCellRanges(row: SyntaxNode, delimiters: readonly SyntaxNode[]): MarkdownTableSourceRange[] {
    const hasLeadingDelimiter = delimiters[0]?.from === row.from;
    const hasTrailingDelimiter = delimiters[delimiters.length - 1]?.from === row.to - 1;
    const contentFrom = row.from + (hasLeadingDelimiter ? 1 : 0);
    const contentTo = row.to - (hasTrailingDelimiter ? 1 : 0);
    const internalDelimiters = delimiters.filter(
        (delimiter) => delimiter.from >= contentFrom && delimiter.from < contentTo
    );

    const cells: MarkdownTableSourceRange[] = [];
    let cellFrom = contentFrom;
    for (const delimiter of internalDelimiters) {
        cells.push({ from: cellFrom, to: delimiter.from });
        cellFrom = delimiter.to;
    }
    cells.push({ from: cellFrom, to: contentTo });
    return cells;
}

function extractRowSyntax(row: SyntaxNode, tableFrom: number): MarkdownTableSyntaxRow | null {
    const delimiters = row.getChildren('TableDelimiter');
    const contentNodes = row.getChildren('TableCell');
    const rawCells = buildRawCellRanges(row, delimiters);
    const assignedContent = new Set<SyntaxNode>();
    const cells: MarkdownTableSyntaxCell[] = [];

    for (const raw of rawCells) {
        const matchingContent = contentNodes.filter((node) => node.from >= raw.from && node.to <= raw.to);
        if (matchingContent.length > 1) {
            return null;
        }

        const contentNode = matchingContent[0] ?? null;
        if (contentNode) {
            assignedContent.add(contentNode);
        }
        cells.push({
            raw: { from: raw.from - tableFrom, to: raw.to - tableFrom },
            content: contentNode ? toRelativeRange(contentNode, tableFrom) : null,
        });
    }

    if (assignedContent.size !== contentNodes.length) {
        return null;
    }

    return {
        ...toRelativeRange(row, tableFrom),
        cells,
    };
}

/**
 * Converts a root-level Lezer `Table` node into stable, table-relative syntax facts.
 * Tables nested in any Markdown container are intentionally unsupported.
 */
export function extractRootMarkdownTableSyntax(tableNode: SyntaxNode): MarkdownTableSyntax | null {
    if (tableNode.name !== 'Table' || tableNode.parent?.name !== 'Document') {
        return null;
    }

    const headers = tableNode.getChildren('TableHeader');
    const separators = tableNode.getChildren('TableDelimiter');
    if (headers.length !== 1 || separators.length !== 1) {
        return null;
    }

    const tableFrom = tableNode.from;
    const header = extractRowSyntax(headers[0], tableFrom);
    if (!header) {
        return null;
    }

    const bodyRows: MarkdownTableSyntaxRow[] = [];
    for (const rowNode of tableNode.getChildren('TableRow')) {
        const row = extractRowSyntax(rowNode, tableFrom);
        if (!row) {
            return null;
        }
        bodyRows.push(row);
    }

    return {
        header,
        separator: toRelativeRange(separators[0], tableFrom),
        bodyRows,
    };
}

/**
 * Parses text containing exactly one root-level GFM table and optional outer whitespace.
 * Non-whitespace content outside the table, additional tables, and nested tables are rejected.
 */
export function parseRootMarkdownTableSyntax(text: string): ParsedRootMarkdownTableSyntax | null {
    const root = markdownTableParser.parse(text).topNode;
    const tables = root.getChildren('Table');
    if (tables.length !== 1) {
        return null;
    }

    const table = tables[0];
    if (text.slice(0, table.from).trim().length > 0 || text.slice(table.to).trim().length > 0) {
        return null;
    }

    const syntax = extractRootMarkdownTableSyntax(table);
    return syntax ? { from: table.from, to: table.to, syntax } : null;
}
