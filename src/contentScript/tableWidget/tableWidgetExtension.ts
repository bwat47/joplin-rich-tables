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

/**
 * Build decorations for all tables in the document.
 * Tables with cursor inside are not decorated (raw markdown is shown for editing).
 */
function buildTableDecorations(state: EditorState): DecorationSet {
    const decorations: Range<Decoration>[] = [];
    const tables = findTableRanges(state);
    const activeCell = getActiveCell(state);

    for (const table of tables) {
        // Check if this table is currently active (has an open cell editor).
        const isActiveTable = activeCell && activeCell.tableFrom === table.from;

        // Skip tables where cursor is inside - let user edit raw markdown.
        // EXCEPTION: If the table is active, we MUST render the widget to support the nested editor,
        // even if the main selection has moved inside the table range (e.g. via Android touch events,
        // which might update selection despite preventDefault handlers).
        if (!isActiveTable && cursorInRange(state, table.from, table.to)) {
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
                // For undo/redo, we need to determine if it's a structural change (row/col add/delete)
                // or an in-cell text edit. Structural changes require a full rebuild; in-cell edits
                // should preserve the nested editor DOM.
                // NOTE: We check this directly here because TransactionExtender effects aren't
                // visible to StateField.update() in the same transaction cycle.
                const isUndoRedo = transaction.isUserEvent('undo') || transaction.isUserEvent('redo');
                if (isUndoRedo) {
                    let isStructuralChange = false;
                    transaction.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
                        const deletedText = transaction.startState.doc.sliceString(fromA, toA);
                        const insertedText = inserted.toString();
                        // Newlines indicate row changes; unescaped pipes indicate column changes
                        if (
                            deletedText.includes('\n') ||
                            insertedText.includes('\n') ||
                            hasUnescapedPipe(deletedText) ||
                            hasUnescapedPipe(insertedText)
                        ) {
                            isStructuralChange = true;
                        }
                    });
                    if (isStructuralChange) {
                        return buildTableDecorations(transaction.state);
                    }
                }
                // In-cell edits: map decorations to preserve nested editor DOM
                return decorations.map(transaction.changes);
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

/**
 * Checks if a string contains an unescaped pipe character.
 * An unescaped pipe is one not preceded by an odd number of backslashes.
 */
function hasUnescapedPipe(text: string): boolean {
    let backslashRun = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '\\') {
            backslashRun++;
            continue;
        }
        if (ch === '|') {
            // Pipe is escaped only if preceded by odd number of backslashes
            if (backslashRun % 2 === 0) {
                return true;
            }
        }
        backslashRun = 0;
    }
    return false;
}

/**
 * Clears the active cell on undo/redo if the changes are structural (affect table structure).
 * Structural changes involve newlines or unescaped pipe delimiters (row/column add/delete).
 * Simple text edits within a cell can undo without closing the cell editor.
 */
const clearActiveCellOnUndoRedo = EditorState.transactionExtender.of((tr) => {
    if (!tr.docChanged) {
        return null;
    }
    const isUndoRedo = tr.isUserEvent('undo') || tr.isUserEvent('redo');
    if (!isUndoRedo) {
        return null;
    }
    const activeCell = getActiveCell(tr.startState);
    if (!activeCell) {
        return null;
    }

    // Detect structural changes by checking content, not positions.
    // Structural changes (add/remove row/column) involve newlines or pipe delimiters.
    // In-cell text edits don't contain these characters (pipes are escaped, newlines converted to <br>).
    let isStructuralChange = false;
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        const deletedText = tr.startState.doc.sliceString(fromA, toA);
        const insertedText = inserted.toString();
        // Newlines indicate row additions/deletions
        if (deletedText.includes('\n') || insertedText.includes('\n')) {
            isStructuralChange = true;
        }
        // Unescaped pipes indicate column additions/deletions
        if (hasUnescapedPipe(deletedText) || hasUnescapedPipe(insertedText)) {
            isStructuralChange = true;
        }
    });

    if (isStructuralChange) {
        return { effects: clearActiveCellEffect.of(undefined) };
    }

    return null;
});

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
                clearActiveCellOnUndoRedo,
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
