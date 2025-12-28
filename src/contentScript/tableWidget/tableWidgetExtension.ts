import { EditorView, Decoration, DecorationSet } from '@codemirror/view';
import { EditorState, Range, StateField } from '@codemirror/state';
import { TableWidget } from './TableWidget';
import { parseMarkdownTable, TableData } from '../tableModel/markdownTableParsing';
import { initRenderer } from '../services/markdownRenderer';
import { logger } from '../../logger';
import { hashTableText } from './hashUtils';
import { activeCellField, clearActiveCellEffect, getActiveCell } from './activeCellState';
import { rebuildTableWidgetsEffect } from './tableWidgetEffects';
import {
    closeNestedCellEditor,
    isNestedCellEditorOpen,
    nestedCellEditorPlugin,
    refocusNestedEditor,
    syncAnnotation,
} from '../nestedEditor/nestedCellEditor';
import { createMainEditorActiveCellGuard } from '../nestedEditor/mainEditorGuard';
import { handleTableInteraction } from './tableWidgetInteractions';
import { findTableRanges } from './tablePositioning';
import { isStructuralTableChange } from '../tableModel/structuralChangeDetection';
import { tableToolbarPlugin, tableToolbarTheme } from '../toolbar/tableToolbarPlugin';
import { CLASS_CELL_EDITOR, CLASS_FLOATING_TOOLBAR, getWidgetSelector } from './domHelpers';
import { tableStyles } from './tableStyles';
import { nestedEditorLifecyclePlugin } from './nestedEditorLifecycle';
import { registerTableCommands } from '../tableCommands/tableCommands';
import { createSearchPanelWatcher } from './searchPanelWatcher';

/**
 * Content script context provided by Joplin
 */
interface ContentScriptContext {
    pluginId: string;
    contentScriptId: string;
    postMessage: (message: unknown) => Promise<unknown>;
}

/**
 * Editor control interface provided by Joplin
 */
interface EditorControl {
    editor: EditorView;
    cm6: EditorView;
    addExtension: (extension: unknown) => void;
    registerCommand: (name: string, callback: (...args: unknown[]) => unknown) => void;
}

/**
 * Check if cursor/selection overlaps a given range.
 */
function cursorInRange(state: EditorState, from: number, to: number): boolean {
    const selection = state.selection;
    for (const range of selection.ranges) {
        if (range.from <= to && range.to >= from) {
            return true;
        }
    }
    return false;
}

/**
 * Cache for parsed table data to perform expensive parsing only when content changes.
 * Keys are FNV-1a hashes of the table text.
 * Capped at 50 entries to prevent memory leaks.
 */
const tableParseCache = new Map<string, TableData>();

interface BuildDecorationsOptions {
    /** Skip cursor-in-range check (used during undo/redo to let lifecycle plugin handle activation) */
    skipCursorCheck?: boolean;
}

/**
 * Build decorations for all tables in the document.
 * Tables with cursor inside are not decorated (raw markdown is shown for editing).
 */
function buildTableDecorations(state: EditorState, options?: BuildDecorationsOptions): DecorationSet {
    const decorations: Range<Decoration>[] = [];
    const tables = findTableRanges(state);
    const activeCell = getActiveCell(state);

    for (const table of tables) {
        // Check if this table is currently active (has an open cell editor).
        const isActiveTable = activeCell && activeCell.tableFrom === table.from;

        // Skip tables where cursor is inside - let user edit raw markdown.
        // EXCEPTION 1: If the table is active, we MUST render the widget to support the nested editor,
        // even if the main selection has moved inside the table range (e.g. via Android touch events,
        // which might update selection despite preventDefault handlers).
        // EXCEPTION 2: During undo/redo, skip this check - the lifecycle plugin will handle
        // activating the correct cell, and we need the widget rendered for that to work.
        if (!isActiveTable && !options?.skipCursorCheck && cursorInRange(state, table.from, table.to)) {
            continue;
        }

        const tableHash = hashTableText(table.text);
        let tableData = tableParseCache.get(tableHash);

        if (tableData) {
            // Refresh recency: move to end of Map (most recently used)
            tableParseCache.delete(tableHash);
            tableParseCache.set(tableHash, tableData);
        } else {
            tableData = parseMarkdownTable(table.text);
            if (!tableData) {
                continue;
            }

            // Simple LRU: Delete oldest if at capacity
            if (tableParseCache.size >= 50) {
                const firstKey = tableParseCache.keys().next().value;
                if (firstKey) tableParseCache.delete(firstKey);
            }
            tableParseCache.set(tableHash, tableData);
        }

        const widget = new TableWidget(tableData, table.text, table.from, table.to);
        const decoration = Decoration.replace({
            widget,
            block: true,
        });

        decorations.push(decoration.range(table.from, table.to));
    }

    return Decoration.set(decorations);
}

/**
 * StateField that manages table widget decorations.
 * Block decorations MUST be provided via StateField, not ViewPlugin.
 */
const tableDecorationField = StateField.define<DecorationSet>({
    create(state) {
        logger.info('Table decoration field initialized');
        return buildTableDecorations(state);
    },
    update(decorations, transaction) {
        // Skip decoration rebuilds for internal sync transactions (nested <-> main editor mirroring).
        // These are internal bookkeeping and shouldn't trigger widget recreation.
        const isSync = Boolean(transaction.annotation(syncAnnotation));
        if (isSync) {
            // For sync transactions with doc changes, still map the decorations through.
            if (transaction.docChanged) {
                return decorations.map(transaction.changes);
            }
            return decorations;
        }

        // If we are actively editing a cell via nested editor, keep the existing
        // widget DOM stable by mapping decorations through changes instead of
        // rebuilding (which would recreate widgets and destroy the subview host).
        const activeCell = getActiveCell(transaction.state);

        // Some edits (row/col insert/delete) intentionally require a rebuild so the
        // rendered HTML table matches the new structure.
        const forceRebuild = transaction.effects.some((e) => e.is(rebuildTableWidgetsEffect));
        const hasClearEffect = transaction.effects.some((e) => e.is(clearActiveCellEffect));

        // When active cell is cleared, rebuild to render updated content.
        if (hasClearEffect) {
            return buildTableDecorations(transaction.state);
        }

        if (forceRebuild) {
            return buildTableDecorations(transaction.state);
        }

        if (transaction.docChanged) {
            if (activeCell) {
                // For undo/redo, we need to determine if changes require a full rebuild:
                // 1. Structural changes (row/col add/delete) - table structure changed
                // 2. Changes outside active cell - other cells' content changed
                // In-cell text edits should preserve the nested editor DOM.
                const isUndoRedo = transaction.isUserEvent('undo') || transaction.isUserEvent('redo');
                if (isUndoRedo) {
                    // Structural changes always need rebuild
                    if (isStructuralTableChange(transaction)) {
                        return buildTableDecorations(transaction.state, { skipCursorCheck: true });
                    }
                    // Changes outside active cell need rebuild (other cells' rendered content changed)
                    // Use START state's active cell since change positions are in the old document
                    const prevActiveCell = getActiveCell(transaction.startState);
                    if (prevActiveCell) {
                        let hasChangesOutsideCell = false;
                        transaction.changes.iterChanges((fromA, toA) => {
                            if (fromA < prevActiveCell.cellFrom || toA > prevActiveCell.cellTo) {
                                hasChangesOutsideCell = true;
                            }
                        });
                        if (hasChangesOutsideCell) {
                            return buildTableDecorations(transaction.state, { skipCursorCheck: true });
                        }
                    }
                }
                // In-cell edits: map decorations to preserve nested editor DOM
                return decorations.map(transaction.changes);
            }

            // No active cell - check if this is undo/redo (which may move cursor into a table)
            const isUndoRedo = transaction.isUserEvent('undo') || transaction.isUserEvent('redo');
            if (isUndoRedo) {
                // Skip cursor check - lifecycle plugin will handle cell activation
                return buildTableDecorations(transaction.state, { skipCursorCheck: true });
            }

            return buildTableDecorations(transaction.state);
        }

        // Rebuild decorations when selection changes (enter/exit raw editing mode).
        if (transaction.selection) {
            // Optimization: If the active table hasn't changed, and we are just moving cursor/selection
            // within the active table's widget (or switching cells), we DON'T want to rebuild (which destroys the DOM).
            const prevActiveCell = getActiveCell(transaction.startState);
            const nextActiveCell = getActiveCell(transaction.state);

            if (prevActiveCell && nextActiveCell && prevActiveCell.tableFrom === nextActiveCell.tableFrom) {
                return decorations;
            }

            // Skip rebuilds during pointer drag operations (mouse drag selection).
            // When users drag-select through a table, we don't want to reveal raw markdown
            // mid-drag - this causes flickering and scroll jumps, especially when dragging upward
            // through large tables. The selection extending into a table range should not
            // trigger widget removal during the drag; only deliberate cursor placement should.
            // We distinguish drag (non-empty selection range) from click (cursor at a point).
            if (transaction.isUserEvent('select.pointer')) {
                const hasNonEmptySelection = transaction.state.selection.ranges.some((r) => r.from !== r.to);
                if (hasNonEmptySelection) {
                    return decorations;
                }
            }

            return buildTableDecorations(transaction.state);
        }

        return decorations;
    },
    provide: (field) => EditorView.decorations.from(field),
});

// NOTE: clearActiveCellOnUndoRedo TransactionExtender was removed.
// TransactionExtender effects aren't visible to StateField.update() in the same
// transaction cycle, so dispatching setActiveCellEffect from here doesn't work.
// The undo/redo handling is now done in nestedEditorLifecyclePlugin.update()
// which uses CodeMirror's cursor position (restored by history) to find the correct cell.

// while it might seem better to use pointerdown, it causes scrolling issues on android
const closeOnOutsideClick = EditorView.domEventHandlers({
    mousedown: (event, view) => {
        const target = event.target as HTMLElement | null;
        if (!target) {
            return false;
        }

        // Keep editor open if clicking inside the widget or nested editor.
        if (
            target.closest(getWidgetSelector()) ||
            target.closest(`.${CLASS_CELL_EDITOR}`) ||
            target.closest(`.${CLASS_FLOATING_TOOLBAR}`)
        ) {
            return false;
        }

        const hasActiveCell = Boolean(getActiveCell(view.state));
        const hasNestedEditor = isNestedCellEditorOpen(view);

        if (!hasActiveCell && !hasNestedEditor) {
            return false;
        }

        // Capture the document position BEFORE we close the nested editor and rebuild
        // decorations. Layout changes from rebuilding decorations would otherwise cause
        // CodeMirror to map screen coordinates to the wrong document position.
        const clickPos = view.posAtCoords({ x: event.clientX, y: event.clientY });

        // Close the nested editor first to ensure widget DOM is cleaned up before rebuild.
        if (hasNestedEditor) {
            closeNestedCellEditor(view);
        }

        // Combine clearing active cell and setting selection in a single dispatch.
        // With coordsAt implemented, CodeMirror can now determine precise cell positions,
        // so we can scroll directly without the RAF workaround.
        if (clickPos !== null) {
            view.dispatch({
                selection: { anchor: clickPos },
                effects: hasActiveCell ? clearActiveCellEffect.of(undefined) : [],
                scrollIntoView: true,
            });
            view.focus();
        } else if (hasActiveCell) {
            view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
        }

        return clickPos !== null; // Consume the event only if we handled cursor positioning
    },
});

const tableWidgetInteractionHandlers = EditorView.domEventHandlers({
    mousedown: (event, view) => {
        return handleTableInteraction(view, event);
    },
    click: (event, view) => {
        return handleTableInteraction(view, event);
    },
});

/**
 * Defensive focus handler that reclaims focus for the nested editor when it's
 * unexpectedly stolen (e.g., by Android's focus management after toolbar commands).
 * Uses preventScroll to avoid scroll jumps.
 */
const nestedEditorFocusGuard = EditorView.domEventHandlers({
    focus: (_event, view) => {
        // If the nested editor is open and should have focus, reclaim it.
        // This handles cases where Android or other focus management systems
        // redirect focus to the main editor after toolbar button presses.
        if (isNestedCellEditorOpen(view) && getActiveCell(view.state)) {
            refocusNestedEditor(view);
            return true;
        }
        return false;
    },
});

/**
 * Content script module export.
 */
export default function (context: ContentScriptContext) {
    logger.info('Content script loaded');

    // Initialize the markdown renderer with postMessage function
    initRenderer(context.postMessage);

    return {
        plugin: (editorControl: EditorControl) => {
            logger.info('Registering table widget extension');

            // Check for CM6
            if (!editorControl.cm6) {
                logger.warn('CodeMirror 6 not available, skipping');
                return;
            }

            // Register the extension
            const cm6View = editorControl.cm6;
            editorControl.addExtension([
                createSearchPanelWatcher(cm6View),
                nestedCellEditorPlugin,
                activeCellField,
                createMainEditorActiveCellGuard(() => isNestedCellEditorOpen(cm6View)),

                tableWidgetInteractionHandlers,
                closeOnOutsideClick,
                nestedEditorFocusGuard,
                nestedEditorLifecyclePlugin,
                tableDecorationField,
                tableStyles,
                tableToolbarTheme,
                tableToolbarPlugin,
            ]);

            registerTableCommands(editorControl);

            logger.info('Table widget extension registered');
        },
    };
}
