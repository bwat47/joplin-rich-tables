import { ensureSyntaxTree, syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import { StateField, type EditorState, type SelectionRange } from '@codemirror/state';
import { logger } from '../../logger';
import { buildTableContext, type TableContext, type TableSpan } from '../tableModel/tableContext';

const SYNTAX_TREE_BUDGET_MS = 1000;

export interface TableIndex {
    /** Root tables in document order, non-overlapping. */
    readonly tables: readonly TableContext[];
    /** No complete index is available yet; retry when parsing completes. */
    readonly treeIncomplete: boolean;
}

interface ReusableDerivation {
    readonly table: TableContext['table'];
    readonly cellRanges: TableContext['cellRanges'];
}

function buildReuseMap(previous: TableIndex | undefined): Map<string, ReusableDerivation> {
    return new Map(
        previous?.tables.map((context) => [context.text, { table: context.table, cellRanges: context.cellRanges }]) ??
            []
    );
}

/**
 * True when the table's first character is also its line's first character.
 *
 * Markdown lets a table carry one to three leading spaces, and Lezer opens the `Table` node at
 * the first pipe rather than the line start. Everything downstream is line-based: a block
 * decoration starting mid-line strands the indent on a visible line of its own above the widget,
 * and boundary spacing declines to pad a table whose edges are not line edges. Rather than teach
 * both to carry an indent through every rewrite, an indented table stays out of the index and the
 * editor shows its source.
 */
function startsAtLineStart(state: EditorState, from: number): boolean {
    return state.doc.lineAt(from).from === from;
}

function buildTableIndex(state: EditorState, previous?: TableIndex): TableIndex {
    const tree = syntaxTreeAvailable(state, state.doc.length)
        ? syntaxTree(state)
        : ensureSyntaxTree(state, state.doc.length, SYNTAX_TREE_BUDGET_MS);

    if (!tree) {
        logger.warn('Syntax tree unavailable within timeout; table index deferred until parsing completes');
        return { tables: [], treeIncomplete: true };
    }

    const tables: TableContext[] = [];
    const reuse = buildReuseMap(previous);

    // Root tables are direct children of the tree's top node, so scanning the top-level
    // siblings reaches every candidate and nothing else. The scan shape is what keeps tables
    // nested in Markdown containers out of the index.
    for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
        if (node.name !== 'Table' || !startsAtLineStart(state, node.from)) {
            continue;
        }

        const text = state.doc.sliceString(node.from, node.to);
        const reused = reuse.get(text);
        if (reused) {
            tables.push({ from: node.from, to: node.to, text, ...reused });
            continue;
        }

        const context = buildTableContext(node, text);
        if (context) {
            tables.push(context);
            reuse.set(text, { table: context.table, cellRanges: context.cellRanges });
        }
    }

    return { tables, treeIncomplete: false };
}

export const tableContextField = StateField.define<TableIndex>({
    create: (state) => buildTableIndex(state),
    update(value, transaction) {
        if (transaction.docChanged) {
            return buildTableIndex(transaction.state, value);
        }
        if (value.treeIncomplete && syntaxTreeAvailable(transaction.state, transaction.state.doc.length)) {
            return buildTableIndex(transaction.state, value);
        }
        return value;
    },
});

export function getTableContexts(state: EditorState): readonly TableContext[] {
    return state.field(tableContextField).tables;
}

/** True when `pos` sits inclusively inside the table's `[from, to]` span. */
export function containsPos(ctx: TableSpan, pos: number): boolean {
    return pos >= ctx.from && pos <= ctx.to;
}

/** True when both ends of `range` sit inclusively inside the table's `[from, to]` span. */
export function containsSelection(ctx: TableSpan, range: SelectionRange): boolean {
    return containsPos(ctx, range.from) && containsPos(ctx, range.to);
}

/** Returns the root table inclusively containing `pos`. */
export function getTableContextAtPos(state: EditorState, pos: number): TableContext | null {
    return getTableContexts(state).find((table) => containsPos(table, pos)) ?? null;
}

/** Returns the root table starting exactly at `pos`, the anchor that identifies a table in runtime state. */
export function getTableContextStartingAt(state: EditorState, pos: number): TableContext | null {
    return getTableContexts(state).find((table) => table.from === pos) ?? null;
}

/** Returns the root table ending exactly at `pos`. */
export function getTableContextEndingAt(state: EditorState, pos: number): TableContext | null {
    return getTableContexts(state).find((table) => table.to === pos) ?? null;
}

/** Returns root tables overlapping or abutting the inclusive range `[from, to]`. */
export function getTableContextsTouching(state: EditorState, from: number, to: number): readonly TableContext[] {
    return getTableContexts(state).filter((table) => table.from <= to && table.to >= from);
}

/** Returns root tables entirely contained by the inclusive range `[from, to]`. */
export function getTableContextsWithin(state: EditorState, from: number, to: number): readonly TableContext[] {
    return getTableContexts(state).filter((table) => table.from >= from && table.to <= to);
}
