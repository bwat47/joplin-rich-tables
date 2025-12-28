import { ViewPlugin, ViewUpdate, EditorView } from '@codemirror/view';
import { getActiveCell, clearActiveCellEffect, setActiveCellEffect } from './activeCellState';
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
import { findTableRanges } from './tablePositioning';
import { computeActiveCellForTableText } from '../tableModel/activeCellForTableText';
import { computeMarkdownTableCellRanges, findCellForPos } from '../tableModel/markdownTableCellRanges';
import { isStructuralTableChange } from '../tableModel/structuralChangeDetection';

export const nestedEditorLifecyclePlugin = ViewPlugin.fromClass(
    class {
        private hadActiveCell: boolean;

        constructor(private view: EditorView) {
            this.hadActiveCell = Boolean(getActiveCell(view.state));
        }

        update(update: ViewUpdate): void {
            const hasActiveCell = Boolean(getActiveCell(update.state));
            const activeCell = getActiveCell(update.state);
            const prevActiveCell = getActiveCell(update.startState);
            const isSync = update.transactions.some((tr) => Boolean(tr.annotation(syncAnnotation)));
            const forceRebuild = update.transactions.some((tr) =>
                tr.effects.some((e) => e.is(rebuildTableWidgetsEffect))
            );

            // Detect undo/redo that requires cell repositioning:
            // 1. Structural changes (newlines/pipes) - table structure changed
            // 2. Change affects a different cell than the currently active one
            let needsUndoCellReposition = false;

            if (update.docChanged && !isSync && this.hadActiveCell && prevActiveCell) {
                for (const tr of update.transactions) {
                    if (!tr.isUserEvent('undo') && !tr.isUserEvent('redo')) continue;

                    // Structural change (newlines = rows, unescaped pipes = columns)
                    if (isStructuralTableChange(tr)) {
                        needsUndoCellReposition = true;
                    }

                    // Change affects different cell than active
                    tr.changes.iterChanges((fromA) => {
                        if (fromA < prevActiveCell.cellFrom || fromA > prevActiveCell.cellTo) {
                            needsUndoCellReposition = true;
                        }
                    });
                }
            }

            if (needsUndoCellReposition) {
                // Close the current nested editor
                if (isNestedCellEditorOpen(this.view)) {
                    closeNestedCellEditor(this.view);
                }

                // CodeMirror history restores the cursor position as part of undo/redo.
                // Use the main editor's selection position (after undo) to find the correct cell.
                const cursorPos = update.state.selection.main.head;

                // After DOM updates, find and activate the cell at the cursor position
                requestAnimationFrame(() => {
                    if (!this.view.dom.isConnected) return;
                    this.activateCellAtPosition(cursorPos);
                });

                this.hadActiveCell = hasActiveCell;
                return;
            }

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
                    if (!this.view.dom.isConnected) return;
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

            // If active cell was cleared (for non-structural reasons), close the nested editor.
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

        /**
         * Find the cell at the given position and activate it (dispatch setActiveCellEffect and open nested editor).
         */
        private activateCellAtPosition(cursorPos: number): void {
            const tables = findTableRanges(this.view.state);

            // Find the table containing the cursor position
            const table = tables.find((t) => cursorPos >= t.from && cursorPos <= t.to);

            if (!table) {
                // Cursor is outside any table - clear active cell and restore focus to main editor
                this.view.dispatch({
                    effects: clearActiveCellEffect.of(undefined),
                    selection: { anchor: cursorPos },
                    scrollIntoView: true,
                });
                this.view.focus();
                return;
            }

            // Find which cell in the table contains the cursor
            const relativePos = cursorPos - table.from;
            const ranges = computeMarkdownTableCellRanges(table.text);
            if (!ranges) {
                this.view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
                return;
            }

            // Find the cell containing the cursor, fallback to first body cell
            const targetCell = findCellForPos(ranges, relativePos) ?? { section: 'body' as const, row: 0, col: 0 };

            const newActiveCell = computeActiveCellForTableText({
                tableFrom: table.from,
                tableText: table.text,
                target: targetCell,
            });

            if (!newActiveCell) {
                this.view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
                return;
            }

            const widgetDOM = this.view.dom.querySelector(getWidgetSelector(makeTableId(table.from)));
            if (!widgetDOM) {
                this.view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
                return;
            }

            const selector =
                newActiveCell.section === SECTION_HEADER
                    ? getCellSelector({ section: SECTION_HEADER, row: 0, col: newActiveCell.col })
                    : getCellSelector({
                          section: SECTION_BODY,
                          row: newActiveCell.row,
                          col: newActiveCell.col,
                      });

            const cellElement = widgetDOM.querySelector(selector) as HTMLElement | null;
            if (!cellElement) {
                this.view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
                return;
            }

            this.view.dispatch({
                effects: setActiveCellEffect.of(newActiveCell),
            });

            openNestedCellEditor({
                mainView: this.view,
                cellElement,
                cellFrom: newActiveCell.cellFrom,
                cellTo: newActiveCell.cellTo,
            });
        }

        destroy(): void {
            closeNestedCellEditor(this.view);
        }
    }
);
