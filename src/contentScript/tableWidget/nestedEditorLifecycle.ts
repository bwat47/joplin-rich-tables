import { ViewPlugin, ViewUpdate, EditorView } from '@codemirror/view';
import { getActiveCell, clearActiveCellEffect, ActiveCell } from './activeCellState';
import { rebuildTableWidgetsEffect } from './tableWidgetEffects';
import {
    applyMainSelectionToNestedEditor,
    applyMainTransactionsToNestedEditor,
    closeNestedCellEditor,
    isNestedCellEditorOpen,
    syncAnnotation,
    openNestedCellEditor,
} from '../nestedEditor/nestedCellEditor';
import { findCellElement } from './domHelpers';
import { makeTableId } from '../tableModel/types';
import { findTableRanges } from './tablePositioning';
import { isStructuralTableChange } from '../tableModel/structuralChangeDetection';
import { activateCellAtPosition } from './cellActivation';
import { exitSourceModeEffect, isEffectiveRawMode, toggleSourceModeEffect } from './sourceMode';
import { exitSearchForceSourceModeEffect, setSearchForceSourceModeEffect } from './searchForceSourceMode';
import { Transaction } from '@codemirror/state';

// ============================================================================
// Types
// ============================================================================

interface RawModeEffects {
    exitedSourceMode: boolean;
    exitedSearchForce: boolean;
    hadRawModeToggle: boolean;
}

interface UpdateContext {
    update: ViewUpdate;
    hasActiveCell: boolean;
    activeCell: ActiveCell | null;
    prevActiveCell: ActiveCell | null;
    isSync: boolean;
    forceRebuild: boolean;
    effectiveRawMode: boolean;
    rawModeEffects: RawModeEffects;
    enteredRawMode: boolean;
    exitedRawMode: boolean;
}

// ============================================================================
// Context Building
// ============================================================================

/**
 * Scans transactions for raw-mode-related effects in a single pass.
 * Returns specific exit flags and a general toggle flag for state-based transition detection.
 */
function scanRawModeEffects(transactions: readonly Transaction[]): RawModeEffects {
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

/**
 * Builds a context object containing all derived state needed for the update cycle.
 * Consolidates state gathering into one place, making dependencies explicit.
 */
function buildUpdateContext(update: ViewUpdate, wasEffectiveRawMode: boolean): UpdateContext {
    const activeCell = getActiveCell(update.state);
    const effectiveRawMode = isEffectiveRawMode(update.state);
    const rawModeEffects = scanRawModeEffects(update.transactions);

    return {
        update,
        hasActiveCell: Boolean(activeCell),
        activeCell,
        prevActiveCell: getActiveCell(update.startState),
        isSync: update.transactions.some((tr) => Boolean(tr.annotation(syncAnnotation))),
        forceRebuild: update.transactions.some((tr) => tr.effects.some((e) => e.is(rebuildTableWidgetsEffect))),
        effectiveRawMode,
        rawModeEffects,
        enteredRawMode: rawModeEffects.hadRawModeToggle && !wasEffectiveRawMode && effectiveRawMode,
        exitedRawMode: rawModeEffects.hadRawModeToggle && wasEffectiveRawMode && !effectiveRawMode,
    };
}

// ============================================================================
// Raw Mode Handling
// ============================================================================

/**
 * Handles raw mode exit (source mode or search force source mode).
 * When leaving raw mode, the cursor may sit inside a replaced table range.
 * Re-activates the cell at the cursor once widgets are mounted.
 * @returns true if handled (caller should return early)
 */
function handleRawModeExit(view: EditorView, ctx: UpdateContext): boolean {
    const { rawModeEffects } = ctx;

    if (!rawModeEffects.exitedSourceMode && !rawModeEffects.exitedSearchForce) {
        return false;
    }

    requestAnimationFrame(() => {
        if (!view.dom.isConnected) return;
        if (isEffectiveRawMode(view.state)) return;

        const cursorPos = view.state.selection.main.head;
        activateCellAtPosition(view, cursorPos);

        // Only apply scroll guard when we did NOT activate a cell.
        // When the cursor is in a table, activation logic is responsible for
        // scrolling to the cell. Also, `coordsAtPos()` inside a large replaced
        // table can map to the bottom edge, causing a jump.
        if (!getActiveCell(view.state)) {
            ensureCursorVisible(view);
        }
    });

    return true;
}

/**
 * Handles scroll guards for raw mode transitions.
 * Ensures the cursor remains visible after large decoration changes.
 */
function handleRawModeScrollGuards(view: EditorView, ctx: UpdateContext): void {
    const { enteredRawMode, exitedRawMode, hasActiveCell } = ctx;

    // When entering raw mode, large decoration changes can make the scroll jump.
    if (enteredRawMode) {
        requestAnimationFrame(() => {
            if (!view.dom.isConnected) return;
            if (!isEffectiveRawMode(view.state)) return;
            ensureCursorVisible(view);
        });
    }

    // When exiting raw mode outside a table, there is no cell activation to do the
    // scrolling for us. Ensure the caret stays visible.
    if (exitedRawMode && !hasActiveCell) {
        requestAnimationFrame(() => {
            if (!view.dom.isConnected) return;
            if (isEffectiveRawMode(view.state)) return;
            ensureCursorVisible(view);
        });
    }
}

// ============================================================================
// Undo/Redo Handling
// ============================================================================

/**
 * Detects if undo/redo requires cell repositioning:
 * 1. Structural changes (newlines/pipes) - table structure changed
 * 2. Change affects a different cell than the currently active one
 * 3. Undo/redo moves cursor from outside a table into a table
 */
function detectUndoRedoCellReposition(ctx: UpdateContext, hadActiveCell: boolean): boolean {
    const { update, isSync, effectiveRawMode, prevActiveCell } = ctx;

    if (!update.docChanged || isSync || effectiveRawMode) {
        return false;
    }

    // Case 1 & 2: Had active cell, check for structural changes or changes outside cell
    if (hadActiveCell && prevActiveCell) {
        for (const tr of update.transactions) {
            if (!tr.isUserEvent('undo') && !tr.isUserEvent('redo')) continue;

            // Structural change (newlines = rows, unescaped pipes = columns)
            if (isStructuralTableChange(tr)) {
                return true;
            }

            // Change affects different cell than active
            let affectsDifferentCell = false;
            tr.changes.iterChanges((fromA) => {
                if (fromA < prevActiveCell.cellFrom || fromA > prevActiveCell.cellTo) {
                    affectsDifferentCell = true;
                }
            });
            if (affectsDifferentCell) {
                return true;
            }
        }
    }

    // Case 3: No active cell, but undo/redo may move cursor into a table
    if (!hadActiveCell) {
        const isUndoRedo = update.transactions.some((tr) => tr.isUserEvent('undo') || tr.isUserEvent('redo'));
        if (isUndoRedo) {
            const cursorPos = update.state.selection.main.head;
            const tables = findTableRanges(update.state);
            if (tables.some((t) => cursorPos >= t.from && cursorPos <= t.to)) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Handles undo/redo that requires cell repositioning.
 * Closes the current nested editor and re-activates at the new cursor position.
 * @returns true if handled (caller should return early)
 */
function handleUndoRedoCellReposition(view: EditorView, ctx: UpdateContext, hadActiveCell: boolean): boolean {
    if (!detectUndoRedoCellReposition(ctx, hadActiveCell)) {
        return false;
    }

    const { activeCell, update } = ctx;

    // Close the current nested editor with mapped positions.
    // The activeCell in update.state has positions mapped through document changes.
    if (isNestedCellEditorOpen(view)) {
        closeNestedCellEditor(
            view,
            activeCell ? { cellFrom: activeCell.cellFrom, cellTo: activeCell.cellTo } : undefined
        );
    }

    // CodeMirror history restores the cursor position as part of undo/redo.
    // Use the main editor's selection position (after undo) to find the correct cell.
    const cursorPos = update.state.selection.main.head;

    // After DOM updates, find and activate the cell at the cursor position
    requestAnimationFrame(() => {
        if (!view.dom.isConnected) return;
        activateCellAtPosition(view, cursorPos, { clearIfOutside: true });
    });

    return true;
}

// ============================================================================
// Force Rebuild Handling
// ============================================================================

/**
 * Handles force rebuild when a widget rebuild effect is present.
 * Proactively closes and re-opens the nested editor after new widget DOM is mounted.
 * @returns true if handled (caller should return early)
 */
function handleForceRebuild(view: EditorView, ctx: UpdateContext): boolean {
    const { forceRebuild, hasActiveCell, activeCell, isSync } = ctx;

    if (!forceRebuild || !hasActiveCell || !activeCell || isSync) {
        return false;
    }

    if (isNestedCellEditorOpen(view)) {
        closeNestedCellEditor(view);
    }

    requestAnimationFrame(() => {
        if (!view.dom.isConnected) return;

        const cellElement = findCellElement(view, makeTableId(activeCell.tableFrom), activeCell);
        if (!cellElement) {
            view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
            return;
        }

        openNestedCellEditor({
            mainView: view,
            cellElement,
            cellFrom: activeCell.cellFrom,
            cellTo: activeCell.cellTo,
        });
    });

    return true;
}

// ============================================================================
// Active Cell Sync
// ============================================================================

/**
 * Handles main -> subview document sync.
 */
function handleMainToSubviewDocSync(view: EditorView, ctx: UpdateContext): void {
    const { update, hasActiveCell, activeCell, isSync } = ctx;

    if (update.docChanged && hasActiveCell && activeCell && isNestedCellEditorOpen(view) && !isSync) {
        applyMainTransactionsToNestedEditor(view, {
            transactions: update.transactions,
            cellFrom: activeCell.cellFrom,
            cellTo: activeCell.cellTo,
        });
    }
}

/**
 * Handles main -> subview selection sync.
 * Some Joplin-native commands (e.g. Insert Link dialog) update the main editor
 * selection after inserting text. Mirror that selection into the nested editor.
 */
function handleMainToSubviewSelectionSync(view: EditorView, ctx: UpdateContext): void {
    const { update, hasActiveCell, activeCell, prevActiveCell, isSync } = ctx;

    // Avoid doing this while switching between cells. Cell switches are
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
        isNestedCellEditorOpen(view) &&
        !isSync
    ) {
        applyMainSelectionToNestedEditor(view, {
            selection: update.state.selection,
            cellFrom: activeCell.cellFrom,
            cellTo: activeCell.cellTo,
            focus: true,
        });
    }
}

/**
 * Handles stale active cell state cleanup.
 * If the document changed externally while editing but we don't have an open subview,
 * clear state to avoid stale ranges.
 */
function handleStaleActiveCellCleanup(view: EditorView, ctx: UpdateContext): void {
    const { update, hasActiveCell, activeCell, isSync } = ctx;

    if (update.docChanged && hasActiveCell && activeCell && !isNestedCellEditorOpen(view) && !isSync) {
        view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
    }
}

// ============================================================================
// Utilities
// ============================================================================

function ensureCursorVisible(view: EditorView): void {
    const cursorPos = view.state.selection.main.head;
    const coords = view.coordsAtPos(cursorPos);
    if (!coords) return;

    const viewport = view.scrollDOM.getBoundingClientRect();
    const cursorAbove = coords.top < viewport.top;
    const cursorBelow = coords.bottom > viewport.bottom;
    if (!cursorAbove && !cursorBelow) return;

    view.dispatch({ effects: EditorView.scrollIntoView(cursorPos, { y: 'nearest' }) });
}

// ============================================================================
// Plugin Definition
// ============================================================================

export const nestedEditorLifecyclePlugin = ViewPlugin.fromClass(
    class {
        private hadActiveCell: boolean;
        private wasEffectiveRawMode: boolean;

        constructor(private view: EditorView) {
            this.hadActiveCell = Boolean(getActiveCell(view.state));
            this.wasEffectiveRawMode = isEffectiveRawMode(view.state);
        }

        update(update: ViewUpdate): void {
            const ctx = buildUpdateContext(update, this.wasEffectiveRawMode);

            // === RAW MODE TRANSITIONS ===
            if (handleRawModeExit(this.view, ctx)) {
                this.updateTrackedState(ctx);
                return;
            }
            handleRawModeScrollGuards(this.view, ctx);

            // === UNDO/REDO ===
            if (handleUndoRedoCellReposition(this.view, ctx, this.hadActiveCell)) {
                this.updateTrackedState(ctx);
                return;
            }

            // === FORCE REBUILD ===
            if (handleForceRebuild(this.view, ctx)) {
                this.updateTrackedState(ctx);
                return;
            }

            // === ACTIVE CELL DEACTIVATION ===
            if (!ctx.hasActiveCell && this.hadActiveCell) {
                closeNestedCellEditor(this.view);
            }

            // === MAIN <-> SUBVIEW SYNC ===
            handleMainToSubviewDocSync(this.view, ctx);
            handleMainToSubviewSelectionSync(this.view, ctx);
            handleStaleActiveCellCleanup(this.view, ctx);

            this.updateTrackedState(ctx);
        }

        private updateTrackedState(ctx: UpdateContext): void {
            this.hadActiveCell = ctx.hasActiveCell;
            this.wasEffectiveRawMode = ctx.effectiveRawMode;
        }

        destroy(): void {
            closeNestedCellEditor(this.view);
        }
    }
);
