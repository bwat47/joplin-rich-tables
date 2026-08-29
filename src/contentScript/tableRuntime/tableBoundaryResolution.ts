import type { EditorState } from '@codemirror/state';
import type { TableContext } from '../tableModel/tableContext';
import { isBlankLineContent } from './tableBoundarySpacing';
import { resolveTableContextAtPos } from './tableResolution';

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
}

// A rendered widget implies that table parsing has already completed. Keyboard handling
// must never block waiting for syntax work on the keyboard event path.
export const TABLE_LOOKUP_TIMEOUT_MS = 0;

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
    return { count, edge };
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
    return { count, edge };
}

function resolveTableEndingAt(state: EditorState, pos: number): TableContext | null {
    if (pos < 0 || pos > state.doc.length) {
        return null;
    }
    const ctx = resolveTableContextAtPos(state, pos, TABLE_LOOKUP_TIMEOUT_MS);
    return ctx && ctx.to === pos ? ctx : null;
}

function resolveTableStartingAt(state: EditorState, pos: number): TableContext | null {
    if (pos < 0 || pos > state.doc.length) {
        return null;
    }
    const ctx = resolveTableContextAtPos(state, pos, TABLE_LOOKUP_TIMEOUT_MS);
    return ctx && ctx.from === pos ? ctx : null;
}

/**
 * The table that the span `[from, to)` separates from its neighbour, or null.
 *
 * A span between two tables separates both, so `preferred` decides which one wins. Table
 * resolution parses the table it finds, so the preferred side is probed first and the other
 * only when it misses.
 */
export function resolveAdjoiningTable(
    state: EditorState,
    from: number,
    to: number,
    preferred: TableSide
): AdjoiningTable | null {
    const sides: TableSide[] = preferred === 'before' ? ['before', 'after'] : ['after', 'before'];
    for (const side of sides) {
        const ctx = side === 'before' ? resolveTableEndingAt(state, from) : resolveTableStartingAt(state, to);
        if (ctx) {
            return { ctx, side };
        }
    }

    return null;
}

/** Both tables the span `[from, to)` separates. A span can sit between two of them. */
export function resolveAdjacentTables(state: EditorState, from: number, to: number): AdjacentTables {
    return {
        before: resolveTableEndingAt(state, from),
        after: resolveTableStartingAt(state, to),
    };
}
