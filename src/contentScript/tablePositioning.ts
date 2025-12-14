import { ensureSyntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import type { EditorView } from '@codemirror/view';
import { computeMarkdownTableCellRanges, type TableCellRanges, type CellRange } from './markdownTableCellRanges';
import { getActiveCell, type ActiveCellSection } from './activeCellState';

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

/**
 * Resolve a table from an event target, using a best-effort set of fallbacks.
 *
 * Order:
 * 1) DOM -> doc position via `view.posAtDOM`
 * 2) Active cell fallback (when nested editor is open)
 * 3) Widget container dataset fallback (tableFrom/tableTo)
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

    // Fallback: when a nested cell editor is open, activeCell is mapped through changes and
    // provides a stable in-doc position.
    const activeCell = getActiveCell(view.state);
    if (activeCell) {
        const resolved = resolveTableAtPos(view.state, activeCell.cellFrom);
        if (resolved) {
            return resolved;
        }
    }

    // Last fallback: if the widget provides table bounds on its container.
    const container = target.closest('.cm-table-widget') as HTMLElement | null;
    if (container) {
        const tableFrom = Number(container.dataset.tableFrom);
        const tableTo = Number(container.dataset.tableTo);
        if (Number.isFinite(tableFrom) && Number.isFinite(tableTo) && tableFrom >= 0 && tableTo >= tableFrom) {
            return {
                from: tableFrom,
                to: tableTo,
                text: view.state.doc.sliceString(tableFrom, tableTo),
            };
        }
    }

    return null;
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
