import { EditorView, Decoration, DecorationSet } from '@codemirror/view';
import { EditorState, Range, StateField, ChangeSet } from '@codemirror/state';
import { TableWidget } from './TableWidget';
import { parseMarkdownTable, TableData } from '../tableModel/markdownTableParsing';
import { initRenderer } from '../services/markdownRenderer';
import { documentDefinitionsField } from '../services/documentDefinitions';
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
import { searchPanelWatcherPlugin } from './searchPanelWatcher';
import { sourceModeField, toggleSourceModeEffect, isEffectiveRawMode } from './sourceMode';
import { searchForceSourceModeField, setSearchForceSourceModeEffect } from './searchForceSourceMode';

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
 * Cache for parsed table data to perform expensive parsing only when content changes.
 * Keys are FNV-1a hashes of the table text.
 * Capped at 50 entries to prevent memory leaks.
 */
const tableParseCache = new Map<string, TableData>();
const MAX_TABLE_PARSE_CACHE_SIZE = 50;

/**
 * Retrieves parsed table data from cache or parses it if missing.
 * Manages LRU cache eviction.
 */
function getCachedOrParseTableData(text: string): { data: TableData; parseHash: string } | null {
    const parseHash = hashTableText(text);
    let tableData = tableParseCache.get(parseHash);

    if (tableData) {
        // Refresh recency: move to end of Map (most recently used)
        tableParseCache.delete(parseHash);
        tableParseCache.set(parseHash, tableData);
    } else {
        tableData = parseMarkdownTable(text);
        if (!tableData) {
            return null;
        }

        // Simple LRU: Delete oldest if at capacity
        if (tableParseCache.size >= MAX_TABLE_PARSE_CACHE_SIZE) {
            const firstKey = tableParseCache.keys().next().value;
            if (firstKey) tableParseCache.delete(firstKey);
        }
        tableParseCache.set(parseHash, tableData);
    }

    return { data: tableData, parseHash };
}
/**
 * Rebuild only the decoration for a single table, mapping all other decorations.
 * This is used for structural changes (row/col add/delete) to avoid rebuilding all tables.
 */
function rebuildSingleTable(
    state: EditorState,
    decorations: DecorationSet,
    oldTableFrom: number,
    changes: ChangeSet
): DecorationSet {
    // Map the old tableFrom position through the changes to find where it is now
    const newTableFrom = changes.mapPos(oldTableFrom);

    // Find the table at the new position
    const tables = findTableRanges(state);
    const targetTable = tables.find((t) => t.from === newTableFrom);

    if (!targetTable) {
        // Table no longer exists - just map existing decorations
        return decorations.map(changes);
    }

    // Build new decoration for the target table
    const definitions = state.field(documentDefinitionsField);
    const parsed = getCachedOrParseTableData(targetTable.text);

    if (!parsed) {
        return decorations.map(changes);
    }

    const { data: tableData } = parsed;

    const contentHash = hashTableText(targetTable.text + definitions.definitionBlock);
    const widget = new TableWidget(
        tableData,
        targetTable.text,
        targetTable.from,
        targetTable.to,
        definitions.definitionBlock,
        contentHash
    );
    const newDecoration = Decoration.replace({ widget, block: true });

    // Build new decoration set: map all decorations through changes, then replace the target
    const mapped = decorations.map(changes);
    const result: Range<Decoration>[] = [];

    // Keep all decorations except those that overlap the new table range
    // Structural changes (like adding a row above) shift the table's position,
    // so checking `from !== targetTable.from` is insufficient.
    mapped.between(0, state.doc.length, (from, to, deco) => {
        // If decoration overlaps with the new target table, drop it (it's the old version)
        if (to <= targetTable.from || from >= targetTable.to) {
            result.push(deco.range(from, to));
        }
    });

    // Add the new decoration for the rebuilt table
    result.push(newDecoration.range(targetTable.from, targetTable.to));

    // Valid DecorationSets MUST be sorted. Since we are manually constructing the array
    // (and potentially appending out of order), we must sort it explicitly to be safe.
    result.sort((a, b) => a.from - b.from);

    return Decoration.set(result, true); // true = we have manually sorted it
}

/**
 * Build decorations for all tables in the document.
 * Tables are always rendered as widgets - editing happens via nested cell editors.
 */
function buildTableDecorations(state: EditorState): DecorationSet {
    const decorations: Range<Decoration>[] = [];
    const tables = findTableRanges(state);
    const definitions = state.field(documentDefinitionsField);

    for (const table of tables) {
        const result = getCachedOrParseTableData(table.text);
        if (!result) {
            continue;
        }
        const { data: tableData } = result;

        // Content hash includes definition block so widgets rebuild when definitions change.
        const contentHash = hashTableText(table.text + definitions.definitionBlock);

        const widget = new TableWidget(
            tableData,
            table.text,
            table.from,
            table.to,
            definitions.definitionBlock,
            contentHash
        );
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
 * Tables are always rendered as widgets - no "raw markdown" mode.
 */
const tableDecorationField = StateField.define<DecorationSet>({
    create(state) {
        logger.info('Table decoration field initialized');
        return buildTableDecorations(state);
    },
    update(decorations, transaction) {
        // Raw markdown mode: either user source mode or search-forced override.
        const rawModeToggled = transaction.effects.some(
            (e) => e.is(toggleSourceModeEffect) || e.is(setSearchForceSourceModeEffect)
        );
        const effectiveRawMode = isEffectiveRawMode(transaction.state);

        if (rawModeToggled) {
            if (effectiveRawMode) {
                return Decoration.none;
            }
            return buildTableDecorations(transaction.state);
        }

        if (effectiveRawMode) {
            return Decoration.none;
        }

        // Skip decoration rebuilds for internal sync transactions (nested <-> main editor mirroring).
        const isSync = Boolean(transaction.annotation(syncAnnotation));
        if (isSync) {
            if (transaction.docChanged) {
                return decorations.map(transaction.changes);
            }
            return decorations;
        }
        // Map all other decorations to preserve their state.
        const rebuildEffect = transaction.effects.find((e) => e.is(rebuildTableWidgetsEffect));
        if (rebuildEffect) {
            const { tableFrom } = rebuildEffect.value;
            return rebuildSingleTable(transaction.state, decorations, tableFrom, transaction.changes);
        }

        // Document changes: rebuild only if they could affect tables.
        if (transaction.docChanged) {
            const activeCell = getActiveCell(transaction.state);

            if (activeCell) {
                // For undo/redo with active cell, check if rebuild is needed:
                // - Structural changes (row/col add/delete)
                // - Changes outside active cell (other cells' content changed)
                const isUndoRedo = transaction.isUserEvent('undo') || transaction.isUserEvent('redo');
                if (isUndoRedo) {
                    if (isStructuralTableChange(transaction)) {
                        return buildTableDecorations(transaction.state);
                    }
                    const prevActiveCell = getActiveCell(transaction.startState);
                    if (prevActiveCell) {
                        let hasChangesOutsideCell = false;
                        transaction.changes.iterChanges((fromA, toA) => {
                            if (fromA < prevActiveCell.cellFrom || toA > prevActiveCell.cellTo) {
                                hasChangesOutsideCell = true;
                            }
                        });
                        if (hasChangesOutsideCell) {
                            return buildTableDecorations(transaction.state);
                        }
                    }
                }
                // In-cell edits: map decorations to preserve nested editor DOM
                return decorations.map(transaction.changes);
            }

            // Detect large document replacements (e.g., note switching).
            // When most of the old document is replaced, we must rebuild fresh.
            // Also, normal edits outside the active cell should rebuild to ensure
            // widget positions (data-table-from) are kept in sync with the document.
            // (TableWidget.updateDOM handles efficient DOM reuse even on rebuild).
            return buildTableDecorations(transaction.state);
        }

        // Selection-only changes: no rebuild needed.
        // Tables are always widgets; cell activation is handled by lifecycle plugin.
        return decorations;
    },
    provide: (field) => EditorView.decorations.from(field),
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

        // Capture the document position BEFORE we close the nested editor.
        const clickPos = view.posAtCoords({ x: event.clientX, y: event.clientY });

        // Close the nested editor.
        if (hasNestedEditor) {
            closeNestedCellEditor(view);
        }

        // Clear active cell state and set selection. No rebuild is triggered;
        // the widget stays as-is since tables are always rendered as widgets.
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
                searchPanelWatcherPlugin,
                searchForceSourceModeField,
                sourceModeField,
                nestedCellEditorPlugin,
                activeCellField,
                createMainEditorActiveCellGuard(() => isNestedCellEditorOpen(cm6View)),

                tableWidgetInteractionHandlers,
                closeOnOutsideClick,
                nestedEditorFocusGuard,
                nestedEditorLifecyclePlugin,
                tableDecorationField,
                documentDefinitionsField,
                tableStyles,
                tableToolbarTheme,
                tableToolbarPlugin,
            ]);

            registerTableCommands(editorControl);

            logger.info('Table widget extension registered');
        },
    };
}
