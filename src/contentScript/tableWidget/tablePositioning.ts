import { ensureSyntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import type { EditorView } from '@codemirror/view';
import { getCellRange, type TableCellRanges, type CellRange } from '../tableModel/markdownTableCellRanges';
import { getWidgetSelector } from './domHelpers';
import { getActiveCell } from './activeCellState';
import type { CellCoords } from '../tableModel/types';

export interface ResolvedTable {
    from: number;
    to: number;
    text: string;
}

const TABLE_SYNTAX_TREE_SCAN_TIMEOUT_MS = 500;

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
const TABLE_SYNTAX_TREE_RESOLVE_TIMEOUT_MS = 1500;

/**
 * Resolve the Lezer `Table` node that contains `pos`.
 */
export function resolveTableAtPos(
    state: EditorState,
    pos: number,
    timeoutMs: number = TABLE_SYNTAX_TREE_RESOLVE_TIMEOUT_MS
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
                const rawText = doc.sliceString(node.from, node.to);
                const text = trimTrailingNonTableLines(rawText);
                const to = node.from + text.length;
                tables.push({ from: node.from, to, text });
            }
        },
    });

    return tables;
}

/**
 * Resolve a table from an event target, using a best-effort set of fallbacks.
 *
 * Order:
 * 1) DOM -> doc position via `view.posAtDOM`
 * 2) Widget container -> doc position via `view.posAtDOM`
 * 3) Active cell fallback (when nested editor is open)
 */
export function resolveTableFromEventTarget(view: EditorView, target: HTMLElement): ResolvedTable | null {
    // Best case: map DOM->doc position.
    try {
        const pos = view.posAtDOM(target, 0);
        const resolved = resolveTableAtPos(view.state, pos);
        if (resolved) {
            return resolved;
        }
    } catch {
        // Some DOM nodes inside replacement widgets can fail `posAtDOM`.
    }

    // Next best: try mapping the widget container itself. This avoids relying on
    // potentially-stale dataset anchors when decorations are mapped through edits
    // while a nested editor is open.
    const container = target.closest(getWidgetSelector()) as HTMLElement | null;
    if (container) {
        try {
            const pos = view.posAtDOM(container, 0);
            const resolved = resolveTableAtPos(view.state, pos);
            if (resolved) {
                return resolved;
            }
        } catch {
            // Fall through to activeCell fallback.
        }
    }

    // Fallback: when a nested cell editor is open, activeCell is mapped through changes and
    // provides a stable in-doc position.
    const activeCell = getActiveCell(view.state);
    if (activeCell) {
        const resolved = resolveTableAtPos(view.state, activeCell.cellFrom);
        if (resolved) {
            return resolved;
        }
    }

    return null;
}

export function resolveCellDocRange(params: {
    tableFrom: number;
    ranges: TableCellRanges;
    coords: CellCoords;
}): { cellFrom: number; cellTo: number; relRange: CellRange } | null {
    const { tableFrom, ranges, coords } = params;

    const relRange = getCellRange(ranges, coords);
    if (!relRange) {
        return null;
    }

    return {
        cellFrom: tableFrom + relRange.from,
        cellTo: tableFrom + relRange.to,
        relRange,
    };
}
