import { ensureSyntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { getCellRange, type CellRange, type TableCellRanges } from '../tableModel/markdownTableCellRanges';
import { buildTableContext, type TableContext } from '../tableModel/tableContext';
import type { CellCoords, ResolvedTable } from '../tableModel/types';

const TABLE_SYNTAX_TREE_TIMEOUT_MS = 1000;

/**
 * Trims trailing non-table lines from a Lezer-reported table range.
 *
 * Lezer's Markdown parser treats any non-blank line after a table as part of
 * the table until a blank line separator. This function scans backward and
 * excludes lines that don't contain '|' (i.e., not valid table rows).
 *
 * @param text - The raw table text from Lezer's range
 * @returns The trimmed text containing only valid table rows
 */
export function trimTrailingNonTableLines(text: string): string {
    const lines = text.split('\n');

    // Need at least header + separator (2 lines) for a valid table
    while (lines.length > 2) {
        const lastLine = lines[lines.length - 1];
        // A valid table row must contain '|'
        if (lastLine.includes('|')) {
            break;
        }
        lines.pop();
    }

    return lines.join('\n');
}

/**
 * Resolve the Lezer `Table` node that contains `pos`.
 */
export function resolveTableAtPos(
    state: EditorState,
    pos: number,
    timeoutMs: number = TABLE_SYNTAX_TREE_TIMEOUT_MS
): ResolvedTable | null {
    const tree = ensureSyntaxTree(state, pos, timeoutMs);
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

    const rawText = state.doc.sliceString(node.from, node.to);
    const text = trimTrailingNonTableLines(rawText);
    const to = node.from + text.length;

    return { from: node.from, to, text };
}

/**
 * Find all markdown table ranges in the document using the syntax tree.
 */
export function findTableRanges(state: EditorState, timeoutMs: number = TABLE_SYNTAX_TREE_TIMEOUT_MS): ResolvedTable[] {
    const tables: ResolvedTable[] = [];
    const doc = state.doc;

    const tree = ensureSyntaxTree(state, state.doc.length, timeoutMs);
    if (!tree) {
        return tables;
    }

    tree.iterate({
        enter: (node) => {
            if (node.name === 'Table') {
                const rawText = doc.sliceString(node.from, node.to);
                const text = trimTrailingNonTableLines(rawText);
                const to = node.from + text.length;
                tables.push({ from: node.from, to, text });
            }
        },
    });

    return tables;
}

function resolveTableContextFromResolved(resolved: ResolvedTable | null): TableContext | null {
    if (!resolved) {
        return null;
    }

    return buildTableContext(resolved);
}

export function resolveCellDocRange(params: { tableFrom: number; ranges: TableCellRanges; coords: CellCoords }): {
    contentFrom: number;
    contentTo: number;
    editableFrom: number;
    editableTo: number;
    relRange: CellRange;
} | null {
    const { tableFrom, ranges, coords } = params;

    const relRange = getCellRange(ranges, coords);
    if (!relRange) {
        return null;
    }

    return {
        contentFrom: tableFrom + relRange.from,
        contentTo: tableFrom + relRange.to,
        editableFrom: tableFrom + relRange.editableFrom,
        editableTo: tableFrom + relRange.editableTo,
        relRange,
    };
}

/**
 * Resolve a table at `pos` and build a full TableContext (parsed table + cell ranges).
 * Convenience wrapper combining resolveTableAtPos + buildTableContext.
 */
export function resolveTableContextAtPos(state: EditorState, pos: number, timeoutMs?: number): TableContext | null {
    return resolveTableContextFromResolved(resolveTableAtPos(state, pos, timeoutMs));
}
