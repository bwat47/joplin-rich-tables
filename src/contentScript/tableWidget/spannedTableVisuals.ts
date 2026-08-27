import type { EditorState, Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { makeTableId, type TableId } from '../tableModel/types';
import { CLASS_TABLE_WIDGET_SPANNED, collectTableWidgetElements } from './domHelpers';
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
    return collectTableWidgetElements(view, collectSpannedTableIds(view.state));
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
