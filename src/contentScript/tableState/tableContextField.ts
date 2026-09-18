import { ensureSyntaxTree, syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import { StateField, type EditorState } from '@codemirror/state';
import { logger } from '../../logger';
import { buildTableContext, type TableContext } from '../tableModel/tableContext';

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
    // siblings reaches every candidate. Descending further would only walk prose that cannot
    // contain one. `buildTableContext()` re-validates root membership, so the scan shape is
    // not what enforces it.
    for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
        if (node.name !== 'Table') {
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

/** Returns the root table inclusively containing `pos`. */
export function getTableContextAtPos(state: EditorState, pos: number): TableContext | null {
    if (!Number.isInteger(pos) || pos < 0 || pos > state.doc.length) {
        return null;
    }
    return getTableContexts(state).find((table) => pos >= table.from && pos <= table.to) ?? null;
}

/** Returns root tables overlapping or abutting the inclusive range `[from, to]`. */
export function getTableContextsTouching(state: EditorState, from: number, to: number): readonly TableContext[] {
    if (from < 0 || to < from || to > state.doc.length) {
        return [];
    }
    return getTableContexts(state).filter((table) => table.from <= to && table.to >= from);
}

/** Returns root tables entirely contained by the inclusive range `[from, to]`. */
export function getTableContextsWithin(state: EditorState, from: number, to: number): readonly TableContext[] {
    if (from < 0 || to < from || to > state.doc.length) {
        return [];
    }
    return getTableContexts(state).filter((table) => table.from >= from && table.to <= to);
}
