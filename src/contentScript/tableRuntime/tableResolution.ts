import { ensureSyntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { extractCachedRootMarkdownTableSyntax } from '../tableModel/lezerTableSyntax';
import { getCellRange, type CellRange, type TableCellRanges } from '../tableModel/markdownTableCellRanges';
import { buildTableContext, type TableContext } from '../tableModel/tableContext';
import type { CellCoords, ResolvedTable } from '../tableModel/types';

const TABLE_SYNTAX_TREE_TIMEOUT_MS = 1000;

function findTableAncestor(node: SyntaxNode): SyntaxNode | null {
    let current: SyntaxNode | null = node;
    // Exits with either a `Table` node or null once the walk runs off the top of the tree.
    while (current && current.name !== 'Table') {
        current = current.parent;
    }
    return current;
}

function buildResolvedTable(state: EditorState, node: SyntaxNode): ResolvedTable | null {
    const text = state.doc.sliceString(node.from, node.to);
    const syntax = extractCachedRootMarkdownTableSyntax(node, text);
    if (!syntax) {
        return null;
    }

    return {
        from: node.from,
        to: node.to,
        text,
        syntax,
    };
}

function containsPosition(table: ResolvedTable, pos: number): boolean {
    return pos >= table.from && pos <= table.to;
}

/**
 * Resolves a candidate root table node, returning it only when its exact range
 * contains `pos`. Nested tables are outside the plugin's supported syntax.
 */
function resolveIfContaining(state: EditorState, node: SyntaxNode | null, pos: number): ResolvedTable | null {
    if (!node) {
        return null;
    }
    const resolved = buildResolvedTable(state, node);
    return resolved && containsPosition(resolved, pos) ? resolved : null;
}

function isSameNodeRange(a: SyntaxNode | null, b: SyntaxNode | null): boolean {
    if (!a || !b) {
        return false;
    }
    return a.from === b.from && a.to === b.to;
}

/**
 * Resolves the table containing `pos`, or null if `pos` lies outside every table.
 *
 * The range returned matches what {@link findTableRanges} reports for the same table, so
 * point lookups and full-document discovery agree on exact Lezer table boundaries.
 *
 * Two tree lookups are needed. The forward lookup misses a table ending exactly at `pos`,
 * since nothing after `pos` belongs to it; the backward lookup covers that boundary. Each
 * candidate is also checked for direct `Document` ownership because container tables are
 * intentionally unsupported.
 */
export function resolveContainingTableAtPos(
    state: EditorState,
    pos: number,
    timeoutMs: number = TABLE_SYNTAX_TREE_TIMEOUT_MS
): ResolvedTable | null {
    const tree = ensureSyntaxTree(state, pos, timeoutMs);
    if (!tree) {
        return null;
    }

    const tableAfter = findTableAncestor(tree.resolve(pos, 1));
    const resolvedAfter = resolveIfContaining(state, tableAfter, pos);
    if (resolvedAfter) {
        return resolvedAfter;
    }

    const tableBefore = findTableAncestor(tree.resolve(pos, -1));
    // The same-node check is an optimization, not a correctness guard: when both lookups
    // land on the same node, containment was already checked above and failed, so falling
    // through would return null anyway. Short-circuiting skips redundant syntax extraction
    // and source slicing for what may be a large table.
    if (isSameNodeRange(tableBefore, tableAfter)) {
        return null;
    }
    return resolveIfContaining(state, tableBefore, pos);
}

/**
 * Find all markdown table ranges in the document using the syntax tree.
 *
 * Returns `null` (rather than an empty array) when the syntax tree could not be
 * produced within the timeout, so callers can distinguish "no tables" from
 * "parse incomplete" and retry once parsing finishes.
 */
export function findTableRanges(
    state: EditorState,
    timeoutMs: number = TABLE_SYNTAX_TREE_TIMEOUT_MS
): ResolvedTable[] | null {
    const tables: ResolvedTable[] = [];

    const tree = ensureSyntaxTree(state, state.doc.length, timeoutMs);
    if (!tree) {
        return null;
    }

    tree.iterate({
        enter: (node) => {
            if (node.name === 'Table') {
                const table = buildResolvedTable(state, node.node);
                if (table) {
                    tables.push(table);
                }
                return false;
            }
            return undefined;
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
 * Resolve the table containing `pos` and build a full TableContext (parsed table + cell ranges).
 * Convenience wrapper combining resolveContainingTableAtPos + buildTableContext.
 */
export function resolveTableContextAtPos(state: EditorState, pos: number, timeoutMs?: number): TableContext | null {
    return resolveTableContextFromResolved(resolveContainingTableAtPos(state, pos, timeoutMs));
}
