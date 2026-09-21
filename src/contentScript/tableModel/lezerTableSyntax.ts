import type { SyntaxNode } from '@lezer/common';
import { GFM, parser } from '@lezer/markdown';
import { isTablePadding } from '../shared/tablePadding';
import { logger } from '../../logger';

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

export interface ParsedRootMarkdownTableSyntax {
    /** Exact source of the accepted table. Syntax offsets are relative to this slice. */
    readonly tableText: string;
    readonly syntax: MarkdownTableSyntax;
}

/**
 * The exact table source plus the document offset of `text[0]`. Absolute node positions
 * index `text` and rebase to table-relative output through this one offset.
 */
interface TableTextSource {
    readonly text: string;
    readonly tableFrom: number;
}

const markdownTableParser = parser.configure([GFM]);

function toRelativeRange(node: Pick<SyntaxNode, 'from' | 'to'>, source: TableTextSource): MarkdownTableSourceRange {
    return { from: node.from - source.tableFrom, to: node.to - source.tableFrom };
}

function charAt(source: TableTextSource, position: number): string {
    return source.text[position - source.tableFrom];
}

/**
 * An odd trailing backslash makes Lezer include the following space or tab inside `TableCell`.
 * That pad is layout, not content: keeping it would widen the cell on every round trip and
 * surface the pad character inside the cell editor. Every other cell shape already arrives
 * trimmed, so this only rewrites the quirk. Returns null when nothing but padding is left.
 */
function toContentRange(source: TableTextSource, node: SyntaxNode): MarkdownTableSourceRange | null {
    let to = node.to;
    while (to > node.from && isTablePadding(charAt(source, to - 1))) {
        to--;
    }
    return to > node.from ? toRelativeRange({ from: node.from, to }, source) : null;
}

/**
 * Lezer row nodes cover trailing padding, which normally belongs to no cell.
 * The floor is the final TableCell's own end, so a row never trims inside a cell node
 * even where that node holds the pad an odd backslash pulled in.
 */
function trimRowEnd(source: TableTextSource, row: SyntaxNode, contentNodes: readonly SyntaxNode[]): number {
    let to = row.to;
    const finalContentTo = contentNodes[contentNodes.length - 1]?.to ?? row.from;
    while (to > finalContentTo && isTablePadding(charAt(source, to - 1))) {
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
    // A lone pipe serves as both delimiters; its cell is empty rather than reversed.
    const contentTo = Math.max(contentFrom, rowTo - (hasTrailingDelimiter ? 1 : 0));
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

/**
 * Rejecting one node arrangement discards the whole table, so the widget silently
 * disappears for source the editor still shows as a table. Nothing recovers from that
 * at runtime; the log is what makes a field report reproducible. Positions are logged
 * absolute, unlike the returned syntax, so they can be read against the document.
 */
function rejectUnsupportedShape(reason: string, details: Record<string, unknown>): null {
    logger.debug(`Unsupported Lezer table shape, leaving the table unrendered: ${reason}`, details);
    return null;
}

function extractRowSyntax(source: TableTextSource, row: SyntaxNode): MarkdownTableSyntaxRow | null {
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
            return rejectUnsupportedShape('a TableCell does not sit inside a single delimiter gap', {
                rowFrom: row.from,
                rowTo,
                rawCell: raw,
                contentIndex,
            });
        }
        if (contentNode) {
            contentIndex++;
        }

        cells.push({
            raw: toRelativeRange(raw, source),
            content: contentNode ? toContentRange(source, contentNode) : null,
        });
    }

    if (contentIndex !== contentNodes.length) {
        return rejectUnsupportedShape('a row left TableCell nodes unmatched', {
            rowFrom: row.from,
            rowTo,
            matched: contentIndex,
            contentNodes: contentNodes.length,
        });
    }

    return {
        ...toRelativeRange({ from: row.from, to: rowTo }, source),
        cells,
    };
}

/**
 * Converts a root-level Lezer `Table` node into stable, table-relative syntax facts.
 * Tables nested in any Markdown container are intentionally unsupported: callers only pass
 * direct children of the document node, which is what keeps nested tables out.
 */
function extractValidatedRootTableSyntax(source: TableTextSource, tableNode: SyntaxNode): MarkdownTableSyntax | null {
    const headers = tableNode.getChildren('TableHeader');
    const separators = tableNode.getChildren('TableDelimiter');
    if (headers.length !== 1 || separators.length !== 1) {
        return rejectUnsupportedShape('a table is not exactly one header plus one delimiter row', {
            tableFrom: tableNode.from,
            tableTo: tableNode.to,
            headers: headers.length,
            separators: separators.length,
        });
    }

    const header = extractRowSyntax(source, headers[0]);
    if (!header) {
        return null;
    }

    const bodyRows: MarkdownTableSyntaxRow[] = [];
    for (const rowNode of tableNode.getChildren('TableRow')) {
        const row = extractRowSyntax(source, rowNode);
        if (!row) {
            return null;
        }
        bodyRows.push(row);
    }

    return {
        header,
        separator: toRelativeRange(separators[0], source),
        bodyRows,
    };
}

/**
 * Extracts syntax for a root table already located in a document.
 * `tableNode` must be a direct child of the document node, and `tableText` the exact source it covers.
 */
export function extractRootMarkdownTableSyntax(tableNode: SyntaxNode, tableText: string): MarkdownTableSyntax | null {
    return extractValidatedRootTableSyntax({ text: tableText, tableFrom: tableNode.from }, tableNode);
}

/**
 * Parses text containing exactly one root-level GFM table and optional outer whitespace.
 * Non-whitespace content outside the table, additional tables, and nested tables are rejected.
 * On success, `tableText` is the exact table slice and `syntax` is relative to that slice.
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

    const tableText = text.slice(table.from, table.to);
    const syntax = extractValidatedRootTableSyntax({ text: tableText, tableFrom: table.from }, table);
    return syntax ? { tableText, syntax } : null;
}
