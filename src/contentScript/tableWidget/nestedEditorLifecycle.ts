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

            // Detect structural undo/redo (changes containing newlines or pipes).
            // These require repositioning to an adjacent cell because the active cell's
            // coordinates may point to a different cell after the table structure changes.
            const isStructuralUndo =
                update.docChanged &&
                !isSync &&
                this.hadActiveCell &&
                update.transactions.some((tr) => {
                    if (!tr.isUserEvent('undo') && !tr.isUserEvent('redo')) return false;
                    let isStructural = false;
                    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
                        const deletedText = tr.startState.doc.sliceString(fromA, toA);
                        const insertedText = inserted.toString();
                        if (deletedText.includes('\n') || insertedText.includes('\n')) {
                            isStructural = true;
                        }
                        // Check for unescaped pipes
                        if (deletedText.includes('|') || insertedText.includes('|')) {
                            isStructural = true;
                        }
                    });
                    return isStructural;
                });

            if (isStructuralUndo && prevActiveCell) {
                console.log('[nestedEditorLifecycle] Structural undo detected, repositioning cell');
                // Close the current nested editor
                if (isNestedCellEditorOpen(this.view)) {
                    closeNestedCellEditor(this.view);
                }

                // Map the old table position through the undo changes to find where it is now
                const mappedTableFrom = update.changes.mapPos(prevActiveCell.tableFrom, -1);
                console.log(
                    '[nestedEditorLifecycle] Mapping tableFrom:',
                    prevActiveCell.tableFrom,
                    '->',
                    mappedTableFrom
                );

                // After DOM updates, find and activate an adjacent cell
                requestAnimationFrame(() => {
                    const tables = findTableRanges(this.view.state);
                    console.log(
                        '[nestedEditorLifecycle] Tables found:',
                        tables.length,
                        'mapped tableFrom:',
                        mappedTableFrom
                    );

                    // Find the table that contains the mapped position
                    const table =
                        tables.find((t) => mappedTableFrom >= t.from && mappedTableFrom <= t.to) ||
                        tables.find((t) => Math.abs(t.from - mappedTableFrom) < 50);

                    if (!table) {
                        console.log('[nestedEditorLifecycle] No table found');
                        this.view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
                        return;
                    }

                    console.log('[nestedEditorLifecycle] Found table at', table.from);

                    const newActiveCell = computeActiveCellForTableText({
                        tableFrom: table.from,
                        tableText: table.text,
                        target: {
                            section: prevActiveCell.section,
                            row: prevActiveCell.row,
                            col: prevActiveCell.col,
                        },
                    });

                    if (!newActiveCell) {
                        console.log('[nestedEditorLifecycle] Could not compute new active cell');
                        this.view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
                        return;
                    }

                    console.log(
                        '[nestedEditorLifecycle] New cell:',
                        newActiveCell.section,
                        newActiveCell.row,
                        newActiveCell.col
                    );

                    const widgetDOM = this.view.dom.querySelector(getWidgetSelector(makeTableId(table.from)));
                    if (!widgetDOM) {
                        console.log('[nestedEditorLifecycle] Widget DOM not found');
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
                        console.log('[nestedEditorLifecycle] Cell element not found:', selector);
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

        destroy(): void {
            closeNestedCellEditor(this.view);
        }
    }
);
