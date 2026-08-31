import { EditorSelection, EditorState, type Extension, type SelectionRange } from '@codemirror/state';
import { findRenderedTablesTouching, type TableSpan } from '../../tableWidget/tableDecorationField';
import { hasPlainRenderedTableCaret } from '../renderedTableCaret';

/** Looks up every rendered table a document range reaches. */
export type TablesTouching = (from: number, to: number) => readonly TableSpan[];

/** Grows one range until it contains every table it touches, keeping its direction. */
function snapRange(range: SelectionRange, findTablesTouching: TablesTouching): SelectionRange {
    // An empty range is a caret, not a partial selection: it has no inside to speak of, and
    // caret placement around tables is owned by the navigation and entry policies.
    if (range.empty) {
        return range;
    }

    let from = range.from;
    let to = range.to;

    for (const table of findTablesTouching(range.from, range.to)) {
        from = Math.min(from, table.from);
        to = Math.max(to, table.to);
    }

    if (from === range.from && to === range.to) {
        return range;
    }

    return range.anchor <= range.head ? EditorSelection.range(from, to) : EditorSelection.range(to, from);
}

/**
 * Grows a selection so that no range holds part of a rendered table.
 *
 * A table is drawn as one block widget, so a selection reaching into it selects nothing the
 * user can see or act on: the hidden Markdown behind the widget is not what they pointed at,
 * and picking out rows or columns is what the plugin's own cell selection is for. Any contact
 * with a table therefore swallows the whole table, so it is either wholly selected or wholly
 * untouched — never a sliver of source hanging off the end of a drag.
 *
 * @returns The grown selection, or null when nothing needed moving.
 */
export function snapSelectionAroundTables(
    selection: EditorSelection,
    findTablesTouching: TablesTouching
): EditorSelection | null {
    let changed = false;

    const ranges = selection.ranges.map((range) => {
        const snapped = snapRange(range, findTablesTouching);
        changed ||= snapped !== range;
        return snapped;
    });

    // `create` merges any ranges the growth pushed into each other.
    return changed ? EditorSelection.create(ranges, selection.mainIndex) : null;
}

/**
 * Keeps a selection from holding part of a rendered table.
 *
 * Applies to any selection-only transaction on a document the main editor still owns: a nested
 * cell editor, a cell selection and an in-flight entry request each park the main selection
 * inside a table on purpose, and raw mode has no widgets to snap around. Everything the plugin
 * itself dispatches under those conditions moves a bare caret, which this leaves alone.
 *
 * Document changes are left alone too. This exists for selection gestures, which never carry
 * one, and an edit that rewrites a table has its own policies deciding where the caret lands.
 *
 * The original transaction stays first in the returned specs so every annotation and effect it
 * carries survives. The second, sequential spec only replaces its selection with the snapped one.
 */
export const tableSelectionSnapFilter: Extension = EditorState.transactionFilter.of((tr) => {
    if (tr.docChanged || !tr.selection || !hasPlainRenderedTableCaret(tr.startState)) {
        return tr;
    }

    const snapped = snapSelectionAroundTables(tr.selection, (from, to) =>
        findRenderedTablesTouching(tr.startState, from, to)
    );
    if (!snapped) {
        return tr;
    }

    return [tr, { selection: snapped, sequential: true }];
});
