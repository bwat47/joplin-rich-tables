import type { SyntaxNode } from '@lezer/common';
import { GFM, parser } from '@lezer/markdown';
import { isTablePadding } from '../shared/tablePadding';

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

/** Source text plus the document offset of `text[0]`, so absolute node positions can be read. */
interface TableTextSource {
    readonly text: string;
    readonly base: number;
}

const markdownTableParser = parser.configure([GFM]);

export function isRootTableNode(tableNode: SyntaxNode): boolean {
    return tableNode.name === 'Table' && tableNode.parent?.name === 'Document';
}

function toRelativeRange(node: Pick<SyntaxNode, 'from' | 'to'>, tableFrom: number): MarkdownTableSourceRange {
    return { from: node.from - tableFrom, to: node.to - tableFrom };
}

/**
 * Lezer row nodes cover trailing padding, which normally belongs to no cell.
 * An odd trailing backslash can make Lezer include a following space or tab in
 * the final TableCell, so trimming must never cross that syntax-owned content.
 */
function trimRowEnd(source: TableTextSource, row: SyntaxNode, contentNodes: readonly SyntaxNode[]): number {
    let to = row.to;
    const finalContentTo = contentNodes[contentNodes.length - 1]?.to ?? row.from;
    while (to > finalContentTo && isTablePadding(source.text[to - 1 - source.base])) {
        to--;
    }
    return to;
}

function buildRawCellRanges(
    row: SyntaxNode,
    delimiters: readonly SyntaxNode[],
    rowTo: number
): MarkdownTableSourceRange[] {
    const hasLeadingDelimiter = delimiters[0]?.from === row.from;
    const hasTrailingDelimiter = delimiters[delimiters.length - 1]?.from === rowTo - 1;
    const contentFrom = row.from + (hasLeadingDelimiter ? 1 : 0);
    const contentTo = rowTo - (hasTrailingDelimiter ? 1 : 0);
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

/** Returns `undefined` for an unsupported node arrangement, `null` for an empty raw cell. */
function matchOrderedContentNode(
    raw: MarkdownTableSourceRange,
    contentNodes: readonly SyntaxNode[],
    contentIndex: number
): SyntaxNode | null | undefined {
    const candidate = contentNodes[contentIndex];
    if (!candidate) {
        return null;
    }
    if (candidate.from < raw.from) {
        return undefined;
    }
    if (candidate.from >= raw.to) {
        return null;
    }

    const nextCandidate = contentNodes[contentIndex + 1];
    return candidate.to <= raw.to && (!nextCandidate || nextCandidate.from >= raw.to) ? candidate : undefined;
}

function extractRowSyntax(source: TableTextSource, row: SyntaxNode, tableFrom: number): MarkdownTableSyntaxRow | null {
    const delimiters = row.getChildren('TableDelimiter');
    const contentNodes = row.getChildren('TableCell');
    const rowTo = trimRowEnd(source, row, contentNodes);
    const rawCells = buildRawCellRanges(row, delimiters, rowTo);
    const cells: MarkdownTableSyntaxCell[] = [];
    let contentIndex = 0;

    for (const raw of rawCells) {
        // Both collections are source-ordered, so each content node is considered once.
        const contentNode = matchOrderedContentNode(raw, contentNodes, contentIndex);
        if (contentNode === undefined) {
            return null;
        }
        if (contentNode) {
            contentIndex++;
        }

        cells.push({
            raw: { from: raw.from - tableFrom, to: raw.to - tableFrom },
            content: contentNode ? toRelativeRange(contentNode, tableFrom) : null,
        });
    }

    if (contentIndex !== contentNodes.length) {
        return null;
    }

    return {
        from: row.from - tableFrom,
        to: rowTo - tableFrom,
        cells,
    };
}

/**
 * Converts a root-level Lezer `Table` node into stable, table-relative syntax facts.
 * Tables nested in any Markdown container are intentionally unsupported.
 */
function extractValidatedRootTableSyntax(source: TableTextSource, tableNode: SyntaxNode): MarkdownTableSyntax | null {
    if (!isRootTableNode(tableNode)) {
        return null;
    }

    const headers = tableNode.getChildren('TableHeader');
    const separators = tableNode.getChildren('TableDelimiter');
    if (headers.length !== 1 || separators.length !== 1) {
        return null;
    }

    const tableFrom = tableNode.from;
    const header = extractRowSyntax(source, headers[0], tableFrom);
    if (!header) {
        return null;
    }

    const bodyRows: MarkdownTableSyntaxRow[] = [];
    for (const rowNode of tableNode.getChildren('TableRow')) {
        const row = extractRowSyntax(source, rowNode, tableFrom);
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
 * Extracts syntax for a root table already located in a document.
 * `tableText` must be the exact source covered by `tableNode`.
 */
export function extractRootMarkdownTableSyntax(tableNode: SyntaxNode, tableText: string): MarkdownTableSyntax | null {
    return extractValidatedRootTableSyntax({ text: tableText, base: tableNode.from }, tableNode);
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

    const syntax = extractValidatedRootTableSyntax({ text, base: 0 }, table);
    return syntax ? { from: table.from, to: table.to, syntax } : null;
}
