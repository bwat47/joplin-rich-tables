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
import { computeMarkdownTableCellRanges } from '../tableModel/markdownTableCellRanges';

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
            let isStructuralUndo = false;
            let undoChangeFrom = -1; // Position where the undo change occurred

            if (update.docChanged && !isSync && this.hadActiveCell) {
                for (const tr of update.transactions) {
                    if (!tr.isUserEvent('undo') && !tr.isUserEvent('redo')) continue;
                    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
                        undoChangeFrom = fromA; // Capture the change position
                        const deletedText = tr.startState.doc.sliceString(fromA, toA);
                        const insertedText = inserted.toString();
                        if (deletedText.includes('\n') || insertedText.includes('\n')) {
                            isStructuralUndo = true;
                        }
                        // Check for unescaped pipes
                        if (deletedText.includes('|') || insertedText.includes('|')) {
                            isStructuralUndo = true;
                        }
                    });
                }
            }

            // Check if undo/redo affects a different cell than the currently active one.
            // This happens when user edited cell A, moved to cell B, and undoes (which affects cell A).
            const undoAffectsDifferentCell =
                !isStructuralUndo &&
                undoChangeFrom >= 0 &&
                prevActiveCell &&
                (undoChangeFrom < prevActiveCell.cellFrom || undoChangeFrom > prevActiveCell.cellTo);

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

            // When undo/redo affects a different cell than the currently active one,
            // switch to that cell so the user can see the change.
            if (undoAffectsDifferentCell) {
                console.log(
                    '[nestedEditorLifecycle] Undo affects different cell, switching. undoChangeFrom:',
                    undoChangeFrom
                );

                // Close the current nested editor
                if (isNestedCellEditorOpen(this.view)) {
                    closeNestedCellEditor(this.view);
                }

                // Map the change position through undo to find where it is now
                const mappedPos = update.changes.mapPos(undoChangeFrom, 1);

                // After DOM updates, find and open the affected cell
                requestAnimationFrame(() => {
                    const tables = findTableRanges(this.view.state);

                    // Find the table containing the mapped position
                    const table = tables.find((t) => mappedPos >= t.from && mappedPos <= t.to);

                    if (!table) {
                        console.log('[nestedEditorLifecycle] No table found at position', mappedPos);
                        this.view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
                        return;
                    }

                    // Find which cell in the table contains the position
                    const relativePos = mappedPos - table.from;
                    const ranges = computeMarkdownTableCellRanges(table.text);
                    if (!ranges) {
                        this.view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
                        return;
                    }

                    // Find the cell containing this position
                    let targetCell: { section: 'header' | 'body'; row: number; col: number } | null = null;

                    // Check header cells
                    for (let col = 0; col < ranges.headers.length; col++) {
                        const range = ranges.headers[col];
                        if (relativePos >= range.from && relativePos <= range.to) {
                            targetCell = { section: 'header', row: 0, col };
                            break;
                        }
                    }

                    // Check body cells
                    if (!targetCell) {
                        for (let row = 0; row < ranges.rows.length; row++) {
                            for (let col = 0; col < ranges.rows[row].length; col++) {
                                const range = ranges.rows[row][col];
                                if (relativePos >= range.from && relativePos <= range.to) {
                                    targetCell = { section: 'body', row, col };
                                    break;
                                }
                            }
                            if (targetCell) break;
                        }
                    }

                    if (!targetCell) {
                        console.log('[nestedEditorLifecycle] Could not find cell at position', relativePos);
                        this.view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
                        return;
                    }

                    const newActiveCell = computeActiveCellForTableText({
                        tableFrom: table.from,
                        tableText: table.text,
                        target: targetCell,
                    });

                    if (!newActiveCell) {
                        this.view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
                        return;
                    }

                    console.log('[nestedEditorLifecycle] Switching to cell:', targetCell);

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
