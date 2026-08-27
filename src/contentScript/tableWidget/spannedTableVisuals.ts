import type { EditorState, Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { makeTableId, type TableId } from '../tableModel/types';
import { CLASS_TABLE_WIDGET_SPANNED, getWidgetSelector } from './domHelpers';
import { createElementClassSyncPlugin } from './elementClassSync';
import { tableDecorationField } from './tableDecorationField';

/**
 * Returns the ids of tables whose widget range is strictly enclosed by one selection range.
 *
 * CodeMirror only paints its selection layer across a replacement widget when both selection
 * endpoints sit outside the widget. Exact matches, boundary matches, and partial overlaps are
 * excluded so cell backgrounds are only cleared when there is a layer underneath them.
 */
export function collectSpannedTableIds(state: EditorState): Set<TableId> {
    const spanned = new Set<TableId>();
    const tableDecorations = state.field(tableDecorationField, false);
    if (!tableDecorations) {
        return spanned;
    }

    for (const range of state.selection.ranges) {
        // A cursor parked inside a table (an active cell, or a cell selection) is not a
        // document selection spanning it.
        if (range.empty) {
            continue;
        }

        tableDecorations.decorations.between(range.from, range.to, (from, to) => {
            if (from > range.from && to < range.to) {
                spanned.add(makeTableId(from));
            }
        });
    }

    return spanned;
}

function collectSpannedWidgets(view: EditorView): HTMLElement[] {
    const spanned = collectSpannedTableIds(view.state);
    if (spanned.size === 0) {
        return [];
    }

    // Widget identity comes from `posAtDOM()`, never from `data-table-from`, which can be
    // stale when decorations are mapped rather than rebuilt.
    const widgets: HTMLElement[] = [];
    for (const element of view.contentDOM.querySelectorAll<HTMLElement>(getWidgetSelector())) {
        try {
            if (spanned.has(makeTableId(view.posAtDOM(element)))) {
                widgets.push(element);
            }
        } catch {
            // posAtDOM can fail for edge cases, continue
        }
    }

    return widgets;
}

/**
 * Marks table widgets that sit strictly inside a document selection, so they can drop the cell
 * backgrounds that would otherwise hide CodeMirror's selection layer.
 *
 * `.cm-selectionLayer` paints at `z-index: -1`, behind the content, so the selection only
 * shows through cells that have no background of their own.
 */
export const spannedTableVisualsPlugin: Extension = createElementClassSyncPlugin(
    CLASS_TABLE_WIDGET_SPANNED,
    collectSpannedWidgets
);
