import { ensureSyntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { computeMarkdownTableCellRanges, type TableCellRanges, type CellRange } from './markdownTableCellRanges';
import type { ActiveCellSection } from './activeCellState';

export interface ResolvedTable {
    from: number;
    to: number;
    text: string;
}

export const TABLE_SYNTAX_TREE_SCAN_TIMEOUT_MS = 100;
export const TABLE_SYNTAX_TREE_RESOLVE_TIMEOUT_MS = 250;

/**
 * Resolve the Lezer `Table` node that contains `pos`.
 */
export function resolveTableAtPos(
    state: EditorState,
    pos: number,
    timeoutMs: number = TABLE_SYNTAX_TREE_RESOLVE_TIMEOUT_MS
): ResolvedTable | null {
    const tree = ensureSyntaxTree(state, state.doc.length, timeoutMs);
    if (!tree) {
        return null;
    }

    let node: SyntaxNode | null = tree.resolve(pos, 1);
    while (node && node.name !== 'Table') {
        node = node.parent;
    }

    if (!node || node.name !== 'Table') {
        return null;
    }

    return {
        from: node.from,
        to: node.to,
        text: state.doc.sliceString(node.from, node.to),
    };
}

/**
 * Find all markdown table ranges in the document using the syntax tree.
 */
export function findTableRanges(
    state: EditorState,
    timeoutMs: number = TABLE_SYNTAX_TREE_SCAN_TIMEOUT_MS
): ResolvedTable[] {
    const tables: ResolvedTable[] = [];
    const doc = state.doc;

    const tree = ensureSyntaxTree(state, state.doc.length, timeoutMs);
    if (!tree) {
        return tables;
    }

    tree.iterate({
        enter: (node) => {
            if (node.name === 'Table') {
                const text = doc.sliceString(node.from, node.to);
                tables.push({ from: node.from, to: node.to, text });
            }
        },
    });

    return tables;
}

export function getTableCellRanges(tableText: string): TableCellRanges | null {
    return computeMarkdownTableCellRanges(tableText);
}

export function resolveCellDocRange(params: {
    tableFrom: number;
    ranges: TableCellRanges;
    section: ActiveCellSection;
    row: number;
    col: number;
}): { cellFrom: number; cellTo: number; relRange: CellRange } | null {
    const { tableFrom, ranges, section, row, col } = params;

    const relRange = section === 'header' ? ranges.headers[col] : ranges.rows[row]?.[col];
    if (!relRange) {
        return null;
    }

    return {
        cellFrom: tableFrom + relRange.from,
        cellTo: tableFrom + relRange.to,
        relRange,
    };
}
