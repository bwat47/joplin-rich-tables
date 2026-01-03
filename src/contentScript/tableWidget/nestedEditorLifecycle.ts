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
import { findCellElement, SECTION_BODY, SECTION_HEADER } from './domHelpers';
import { makeTableId } from '../tableModel/types';
import { findTableRanges } from './tablePositioning';
import { isStructuralTableChange } from '../tableModel/structuralChangeDetection';
import { activateCellAtPosition } from './cellActivation';
import { exitSourceModeEffect, isSourceModeEnabled, toggleSourceModeEffect } from './sourceMode';
import {
    exitSearchForceSourceModeEffect,
    isSearchForceSourceModeEnabled,
    setSearchForceSourceModeEffect,
} from './searchForceSourceMode';
import { Transaction } from '@codemirror/state';

/**
 * Scans transactions for raw-mode-related effects in a single pass.
 * Returns specific exit flags and a general toggle flag for state-based transition detection.
 */
function scanRawModeEffects(transactions: readonly Transaction[]): {
    exitedSourceMode: boolean;
    exitedSearchForce: boolean;
    hadRawModeToggle: boolean;
} {
    let exitedSourceMode = false;
    let exitedSearchForce = false;
    let hadRawModeToggle = false;

    for (const tr of transactions) {
        for (const e of tr.effects) {
            if (e.is(exitSourceModeEffect)) {
                exitedSourceMode = true;
                hadRawModeToggle = true;
            }
            if (e.is(exitSearchForceSourceModeEffect)) {
                exitedSearchForce = true;
                hadRawModeToggle = true;
            }
            if (e.is(toggleSourceModeEffect) || e.is(setSearchForceSourceModeEffect)) {
                hadRawModeToggle = true;
            }
        }
    }

    return { exitedSourceMode, exitedSearchForce, hadRawModeToggle };
}

export const nestedEditorLifecyclePlugin = ViewPlugin.fromClass(
    class {
        private hadActiveCell: boolean;
        private wasEffectiveRawMode: boolean;

        private ensureCursorVisible(view: EditorView): void {
            const cursorPos = view.state.selection.main.head;
            const coords = view.coordsAtPos(cursorPos);
            if (!coords) return;

            const viewport = view.scrollDOM.getBoundingClientRect();
            const cursorAbove = coords.top < viewport.top;
            const cursorBelow = coords.bottom > viewport.bottom;
            if (!cursorAbove && !cursorBelow) return;

            view.dispatch({ effects: EditorView.scrollIntoView(cursorPos, { y: 'nearest' }) });
        }

        constructor(private view: EditorView) {
            this.hadActiveCell = Boolean(getActiveCell(view.state));
            this.wasEffectiveRawMode = isSourceModeEnabled(view.state) || isSearchForceSourceModeEnabled(view.state);
        }

        update(update: ViewUpdate): void {
            const hasActiveCell = Boolean(getActiveCell(update.state));
            const activeCell = getActiveCell(update.state);
            const prevActiveCell = getActiveCell(update.startState);
            const isSync = update.transactions.some((tr) => Boolean(tr.annotation(syncAnnotation)));
            const forceRebuild = update.transactions.some((tr) =>
                tr.effects.some((e) => e.is(rebuildTableWidgetsEffect))
            );

            // Consolidated effect scan (single pass over transactions)
            const rawModeEffects = scanRawModeEffects(update.transactions);
            const effectiveRawMode = isSourceModeEnabled(update.state) || isSearchForceSourceModeEnabled(update.state);

            // State-based transition detection
            const enteredRawMode = rawModeEffects.hadRawModeToggle && !this.wasEffectiveRawMode && effectiveRawMode;
            const exitedRawMode = rawModeEffects.hadRawModeToggle && this.wasEffectiveRawMode && !effectiveRawMode;

            // When leaving source mode, the cursor may now sit inside a replaced table range,
            // which makes the caret appear "missing". Re-activate the cell at the cursor
            // once widgets are mounted.
            if (rawModeEffects.exitedSourceMode || rawModeEffects.exitedSearchForce) {
                requestAnimationFrame(() => {
                    if (!this.view.dom.isConnected) return;
                    if (isSourceModeEnabled(this.view.state) || isSearchForceSourceModeEnabled(this.view.state)) return;
                    const cursorPos = this.view.state.selection.main.head;
                    activateCellAtPosition(this.view, cursorPos);

                    // Only apply scroll guard when we did NOT activate a cell.
                    // When the cursor is in a table, activation logic is responsible for
                    // scrolling to the cell. Also, `coordsAtPos()` inside a large replaced
                    // table can map to the bottom edge, causing a jump.
                    if (!getActiveCell(this.view.state)) {
                        this.ensureCursorVisible(this.view);
                    }
                });

                this.hadActiveCell = hasActiveCell;
                this.wasEffectiveRawMode = effectiveRawMode;
                return;
            }

            // When entering raw mode, large decoration changes can make the scroll jump.
            // After the DOM settles, ensure the caret is still within the visible viewport.
            if (enteredRawMode) {
                requestAnimationFrame(() => {
                    if (!this.view.dom.isConnected) return;
                    if (!isSourceModeEnabled(this.view.state) && !isSearchForceSourceModeEnabled(this.view.state))
                        return;
                    this.ensureCursorVisible(this.view);
                });
            }

            // When exiting raw mode outside a table, there is no cell activation to do the
            // scrolling for us. Ensure the caret stays visible.
            if (exitedRawMode && !hasActiveCell) {
                requestAnimationFrame(() => {
                    if (!this.view.dom.isConnected) return;
                    if (isSourceModeEnabled(this.view.state) || isSearchForceSourceModeEnabled(this.view.state)) return;
                    this.ensureCursorVisible(this.view);
                });
            }

            // Detect undo/redo that requires cell repositioning:
            // 1. Structural changes (newlines/pipes) - table structure changed
            // 2. Change affects a different cell than the currently active one
            // 3. Undo/redo moves cursor from outside a table into a table
            let needsUndoCellReposition = false;

            if (update.docChanged && !isSync && !effectiveRawMode && this.hadActiveCell && prevActiveCell) {
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

            // Also handle undo/redo when we had no active cell - cursor may move into a table
            if (update.docChanged && !isSync && !effectiveRawMode && !this.hadActiveCell) {
                const isUndoRedo = update.transactions.some((tr) => tr.isUserEvent('undo') || tr.isUserEvent('redo'));
                if (isUndoRedo) {
                    // Check if cursor ends up inside a table
                    const cursorPos = update.state.selection.main.head;
                    const tables = findTableRanges(update.state);
                    const cursorInTable = tables.some((t) => cursorPos >= t.from && cursorPos <= t.to);
                    if (cursorInTable) {
                        needsUndoCellReposition = true;
                    }
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
                    activateCellAtPosition(this.view, cursorPos, { clearIfOutside: true });
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
                    const cellElement = findCellElement(this.view, makeTableId(activeCell.tableFrom), {
                        section: activeCell.section === SECTION_HEADER ? SECTION_HEADER : SECTION_BODY,
                        row: activeCell.section === SECTION_HEADER ? 0 : activeCell.row,
                        col: activeCell.col,
                    });
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
            this.wasEffectiveRawMode = effectiveRawMode;
        }

        destroy(): void {
            closeNestedCellEditor(this.view);
        }
    }
);
