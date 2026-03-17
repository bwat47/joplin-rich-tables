import { ensureSyntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import type { EditorView } from '@codemirror/view';
import { getCellRange, type TableCellRanges, type CellRange } from '../tableModel/markdownTableCellRanges';
import { buildTableContext, type TableContext } from '../tableModel/tableContext';
import { getActiveCell } from '../tableState/activeCellState';
import { getWidgetSelector } from '../tableWidget/domHelpers';
import type { CellCoords, ResolvedTable } from '../tableModel/types';

const TABLE_SYNTAX_TREE_RESOLVE_TIMEOUT_MS = 1500;
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

function resolveTableContextFromResolved(resolved: ResolvedTable | null): TableContext | null {
    if (!resolved) {
        return null;
    }

    return buildTableContext(resolved);
}

function clampDocPos(state: EditorState, pos: number): number {
    return Math.min(Math.max(pos, 0), state.doc.length);
}

function resolveActiveCellTableContext(state: EditorState): TableContext | null {
    const activeCell = getActiveCell(state);
    if (!activeCell) {
        return null;
    }

    const candidatePositions = [activeCell.tableFrom, activeCell.anchorPos].map((pos) => clampDocPos(state, pos));
    const seenPositions = new Set<number>();

    for (const pos of candidatePositions) {
        if (seenPositions.has(pos)) {
            continue;
        }
        seenPositions.add(pos);

        const context = resolveTableContextAtPos(state, pos);
        if (
            context &&
            resolveCellDocRange({ tableFrom: context.from, ranges: context.cellRanges, coords: activeCell })
        ) {
            return context;
        }
    }

    return null;
}

/**
 * Resolve a table context from an event target, using a best-effort set of fallbacks.
 *
 * Order:
 * 1) DOM -> doc position via `view.posAtDOM`
 * 2) Widget container -> doc position via `view.posAtDOM`
 * 3) Active cell fallback (when nested editor is open)
 */
export function resolveTableContextFromEventTarget(view: EditorView, target: HTMLElement): TableContext | null {
    // Best case: map DOM->doc position.
    try {
        const pos = view.posAtDOM(target, 0);
        const context = resolveTableContextFromResolved(resolveTableAtPos(view.state, pos));
        if (context) {
            return context;
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
            const context = resolveTableContextFromResolved(resolveTableAtPos(view.state, pos));
            if (context) {
                return context;
            }
        } catch {
            // Fall through to activeCell fallback.
        }
    }

    // Fallback: prefer the mapped table start, then try the mapped anchor as a
    // secondary recovery path. Either candidate must still resolve the logical cell.
    const activeCellContext = resolveActiveCellTableContext(view.state);
    if (activeCellContext) {
        return activeCellContext;
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

/**
 * Resolve a table at `pos` and build a full TableContext (parsed table + cell ranges).
 * Convenience wrapper combining resolveTableAtPos + buildTableContext.
 */
export function resolveTableContextAtPos(state: EditorState, pos: number, timeoutMs?: number): TableContext | null {
    return resolveTableContextFromResolved(resolveTableAtPos(state, pos, timeoutMs));
}
