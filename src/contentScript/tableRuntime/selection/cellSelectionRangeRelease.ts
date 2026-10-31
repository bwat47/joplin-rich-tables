import { EditorSelection, type SelectionRange } from '@codemirror/state';
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';

import type { TableSpan } from '../../tableModel/tableContext';
import { getActiveCell } from '../../tableState/activeCellState';
import {
    cellSelectionTransitionAnnotation,
    getCellSelection,
    getSelectedTable,
} from '../../tableState/cellSelectionState';
import { getPendingOpenCellRequest } from '../../tableState/openCellRequestState';

/** Keeps the mapped table span from growing over text inserted at its edges. */
const MAP_TABLE_FROM_FORWARD = 1;
const MAP_TABLE_TO_BACKWARD = -1;

function isInsideTable(range: SelectionRange, table: TableSpan): boolean {
    return range.from >= table.from && range.to <= table.to;
}

/**
 * Drops the per-cell ranges a cell selection parked inside `table`, or returns null when
 * there are none.
 *
 * Secondary ranges inside the table are removed. A main range inside it collapses to a caret
 * at its start, which is the focus cell's text start, where a cell selection parked a lone
 * caret before it held per-cell ranges. Ranges elsewhere, such as a caret Ctrl+clicked
 * outside the table, are kept.
 */
export function releaseParkedCellRanges(selection: EditorSelection, table: TableSpan): EditorSelection | null {
    const ranges: SelectionRange[] = [];
    let mainIndex = 0;

    selection.ranges.forEach((range, index) => {
        const isMain = index === selection.mainIndex;
        if (!isInsideTable(range, table)) {
            mainIndex = isMain ? ranges.length : mainIndex;
            ranges.push(range);
        } else if (isMain) {
            mainIndex = ranges.length;
            ranges.push(EditorSelection.cursor(range.from));
        }
    });

    const unchanged =
        ranges.length === selection.ranges.length && ranges.every((range, index) => range.eq(selection.ranges[index]!));

    return unchanged ? null : EditorSelection.create(ranges, mainIndex);
}

/** True when the table is no longer owned by a cell selection, an open cell, or an open request. */
function isTableUnowned(view: EditorView): boolean {
    const { state } = view;
    return !getCellSelection(state) && !getActiveCell(state) && !getPendingOpenCellRequest(state);
}

/**
 * Releases the main-editor ranges a cell selection leaves behind when it ends.
 *
 * A cell selection backs itself with one main-editor range per selected cell
 * (`cellSelectionRanges.ts`). Most paths that end it dispatch only a clearing effect — the
 * scope guard after a Ctrl+click elsewhere, Escape, raw mode, an edit it does not survive —
 * so the ranges would outlive it: drawn as carets the height of the table widget, and
 * blocking arrow entry, which needs a lone caret.
 *
 * Paths that hand the table to an open cell set its selection themselves, so an owned table
 * is left alone. The fix waits for a microtask because dispatching during an update is not
 * allowed; a later transaction in the meantime has already replaced the selection.
 */
export const cellSelectionRangeRelease = ViewPlugin.fromClass(
    class {
        constructor(private readonly view: EditorView) {}

        update(update: ViewUpdate): void {
            const selected = getSelectedTable(update.startState);
            if (!selected || !isTableUnowned(this.view)) {
                return;
            }

            const table: TableSpan = {
                from: update.changes.mapPos(selected.ctx.from, MAP_TABLE_FROM_FORWARD),
                to: update.changes.mapPos(selected.ctx.to, MAP_TABLE_TO_BACKWARD),
            };
            const releasedState = update.state;

            queueMicrotask(() => {
                if (!this.view.dom.isConnected || this.view.state !== releasedState) {
                    return;
                }

                const selection = releaseParkedCellRanges(this.view.state.selection, table);
                if (selection) {
                    this.view.dispatch({ selection, annotations: cellSelectionTransitionAnnotation.of(true) });
                }
            });
        }
    }
);
