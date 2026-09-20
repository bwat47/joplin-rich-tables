import type { EditorState } from '@codemirror/state';
import type { TableContext } from '../tableModel/tableContext';
import { getTableContextEndingAt, getTableContextStartingAt } from '../tableState/tableContextField';
import { isBlankLineContent } from './tableBoundarySpacing';

/** Which side of a boundary a table sits on. */
export type TableSide = 'before' | 'after';

export interface AdjoiningTable {
    ctx: TableContext;
    side: TableSide;
}

export interface AdjacentTables {
    /** Table ending exactly at the boundary's start. */
    before: TableContext | null;
    /** Table starting exactly at the boundary's end. */
    after: TableContext | null;
}

export interface NewlineScan {
    count: number;
    edge: number;
    /**
     * True when the blank space the scan crossed runs all the way to the document edge, so
     * there is no neighbouring line on that side. Such a run holds one more blank line than
     * the same run between two lines of text, because no newline is spent ending a neighbour.
     */
    reachesDocumentEdge: boolean;
}

/** Newlines before `pos`, crossing only blank-line whitespace and stopping at `limit`. */
export function scanNewlinesBackward(state: EditorState, pos: number, limit: number): NewlineScan {
    let cursor = pos;
    let count = 0;
    let edge = pos;
    while (count < limit && cursor > 0) {
        const character = state.doc.sliceString(cursor - 1, cursor);
        if (character === '\n') {
            cursor--;
            edge = cursor;
            count++;
        } else if (isBlankLineContent(character)) {
            cursor--;
        } else {
            break;
        }
    }
    return { count, edge, reachesDocumentEdge: cursor === 0 };
}

/** Newlines after `pos`, crossing only blank-line whitespace and stopping at `limit`. */
export function scanNewlinesForward(state: EditorState, pos: number, limit: number): NewlineScan {
    let cursor = pos;
    let count = 0;
    let edge = pos;
    while (count < limit && cursor < state.doc.length) {
        const character = state.doc.sliceString(cursor, cursor + 1);
        if (character === '\n') {
            cursor++;
            edge = cursor;
            count++;
        } else if (isBlankLineContent(character)) {
            cursor++;
        } else {
            break;
        }
    }
    return { count, edge, reachesDocumentEdge: cursor === state.doc.length };
}

/**
 * The table that the span `[from, to)` separates from its neighbour, or null.
 *
 * A span between two tables separates both, so `preferred` decides which one wins: the
 * preferred side is probed first and the other only when it misses.
 */
export function resolveAdjoiningTable(
    state: EditorState,
    from: number,
    to: number,
    preferred: TableSide
): AdjoiningTable | null {
    const sides: TableSide[] = preferred === 'before' ? ['before', 'after'] : ['after', 'before'];
    for (const side of sides) {
        const ctx = side === 'before' ? getTableContextEndingAt(state, from) : getTableContextStartingAt(state, to);
        if (ctx) {
            return { ctx, side };
        }
    }

    return null;
}

/** Both tables the span `[from, to)` separates. A span can sit between two of them. */
export function resolveAdjacentTables(state: EditorState, from: number, to: number): AdjacentTables {
    return {
        before: getTableContextEndingAt(state, from),
        after: getTableContextStartingAt(state, to),
    };
}
