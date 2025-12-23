import { ViewPlugin, ViewUpdate, EditorView } from '@codemirror/view';
import { getActiveCell, clearActiveCellEffect } from './activeCellState';
import { rebuildTableWidgetsEffect } from './tableWidgetEffects';
import {
    applyMainSelectionToNestedEditor,
    applyMainTransactionsToNestedEditor,
    closeNestedCellEditor,
    isNestedCellEditorOpen,
    syncAnnotation,
    openNestedCellEditor,
} from '../nestedEditor/nestedCellEditor';
import { getCellSelector, getWidgetSelector, SECTION_BODY, SECTION_HEADER } from './domHelpers';
import { makeTableId } from '../tableModel/types';

export const nestedEditorLifecyclePlugin = ViewPlugin.fromClass(
    class {
        private hadActiveCell: boolean;

        constructor(private view: EditorView) {
            this.hadActiveCell = Boolean(getActiveCell(view.state));
        }

        update(update: ViewUpdate): void {
            const hasActiveCell = Boolean(getActiveCell(update.state));
            const activeCell = getActiveCell(update.state);
            const isSync = update.transactions.some((tr) => Boolean(tr.annotation(syncAnnotation)));
            const forceRebuild = update.transactions.some((tr) =>
                tr.effects.some((e) => e.is(rebuildTableWidgetsEffect))
            );

            // If the transaction forces a widget rebuild, the existing table widget DOM will be
            // destroyed *after* plugin updates run. That means the nested editor can still be
            // open at this point, but will be closed during DOM update, leaving focus/caret in
            // the main editor. To keep the editing experience stable, proactively close and
            // re-open after the new widget DOM is mounted.
            if (forceRebuild && hasActiveCell && activeCell && !isSync) {
                if (isNestedCellEditorOpen(this.view)) {
                    closeNestedCellEditor(this.view);
                }

                requestAnimationFrame(() => {
                    const widgetDOM = this.view.dom.querySelector(getWidgetSelector(makeTableId(activeCell.tableFrom)));
                    if (!widgetDOM) {
                        this.view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
                        return;
                    }

                    const selector =
                        activeCell.section === SECTION_HEADER
                            ? getCellSelector({ section: SECTION_HEADER, row: 0, col: activeCell.col })
                            : getCellSelector({ section: SECTION_BODY, row: activeCell.row, col: activeCell.col });

                    const cellElement = widgetDOM.querySelector(selector) as HTMLElement | null;
                    if (!cellElement) {
                        this.view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
                        return;
                    }

                    openNestedCellEditor({
                        mainView: this.view,
                        cellElement,
                        cellFrom: activeCell.cellFrom,
                        cellTo: activeCell.cellTo,
                    });
                });

                this.hadActiveCell = hasActiveCell;
                return;
            }

            // If active cell was cleared, close the nested editor.
            if (!hasActiveCell && this.hadActiveCell) {
                closeNestedCellEditor(this.view);
            }

            // Main -> subview sync.
            if (update.docChanged && hasActiveCell && activeCell && isNestedCellEditorOpen(this.view) && !isSync) {
                applyMainTransactionsToNestedEditor(this.view, {
                    transactions: update.transactions,
                    cellFrom: activeCell.cellFrom,
                    cellTo: activeCell.cellTo,
                });
            }

            // Main -> subview selection sync.
            // Some Joplin-native commands (e.g. Insert Link dialog) update the main editor
            // selection after inserting text. Mirror that selection into the nested editor
            // so the caret ends up where the user expects inside the cell.
            // IMPORTANT: Avoid doing this while switching between cells. Cell switches are
            // driven by a selection+activeCell update that happens before the nested editor
            // is re-mounted in the new cell.
            const prevActiveCell = getActiveCell(update.startState);
            // NOTE: `cellFrom/cellTo` can change when the cell content changes (e.g. when
            // inserting `[]()` for a link). We only use stable identity fields here.
            const isSameActiveCell =
                prevActiveCell &&
                activeCell &&
                prevActiveCell.tableFrom === activeCell.tableFrom &&
                prevActiveCell.section === activeCell.section &&
                prevActiveCell.row === activeCell.row &&
                prevActiveCell.col === activeCell.col;

            if (
                update.selectionSet &&
                isSameActiveCell &&
                hasActiveCell &&
                activeCell &&
                isNestedCellEditorOpen(this.view) &&
                !isSync
            ) {
                applyMainSelectionToNestedEditor(this.view, {
                    selection: update.state.selection,
                    cellFrom: activeCell.cellFrom,
                    cellTo: activeCell.cellTo,
                    focus: true,
                });
            }

            // If the document changed externally while editing but we don't have an open subview,
            // clear state to avoid stale ranges.
            if (update.docChanged && hasActiveCell && activeCell && !isNestedCellEditorOpen(this.view) && !isSync) {
                this.view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
            }

            this.hadActiveCell = hasActiveCell;
        }

        destroy(): void {
            closeNestedCellEditor(this.view);
        }
    }
);
