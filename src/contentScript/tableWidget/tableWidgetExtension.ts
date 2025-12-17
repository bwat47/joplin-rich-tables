import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { EditorState, Range, StateField } from '@codemirror/state';
import { TableWidget } from './TableWidget';
import { parseMarkdownTable } from '../tableModel/markdownTableParsing';
import { initRenderer } from '../services/markdownRenderer';
import { logger } from '../../logger';
import { activeCellField, clearActiveCellEffect, getActiveCell } from './activeCellState';
import { rebuildTableWidgetsEffect } from './tableWidgetEffects';
import {
    applyMainTransactionsToNestedEditor,
    closeNestedCellEditor,
    isNestedCellEditorOpen,
    syncAnnotation,
    openNestedCellEditor,
} from '../nestedEditor/nestedCellEditor';
import { createMainEditorActiveCellGuard } from '../nestedEditor/mainEditorGuard';
import { handleTableInteraction } from './tableWidgetInteractions';
import { findTableRanges } from './tablePositioning';
import { tableToolbarPlugin, tableToolbarTheme } from '../toolbar/tableToolbarPlugin';

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

        const tableData = parseMarkdownTable(table.text);
        if (!tableData) {
            continue;
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
        // If we are actively editing a cell via nested editor, keep the existing
        // widget DOM stable by mapping decorations through changes instead of
        // rebuilding (which would recreate widgets and destroy the subview host).
        const activeCell = getActiveCell(transaction.state);

        // Some edits (row/col insert/delete) intentionally require a rebuild so the
        // rendered HTML table matches the new structure.
        const forceRebuild = transaction.effects.some((e) => e.is(rebuildTableWidgetsEffect));

        // When active cell is cleared, rebuild to render updated content.
        if (transaction.effects.some((e) => e.is(clearActiveCellEffect))) {
            return buildTableDecorations(transaction.state);
        }

        if (forceRebuild) {
            return buildTableDecorations(transaction.state);
        }

        if (transaction.docChanged) {
            if (activeCell) {
                // Undo/redo can restore structural changes (add/delete row/col) that require
                // a full rebuild. Position mapping alone can't handle these cases correctly.
                const isUndoRedo = transaction.isUserEvent('undo') || transaction.isUserEvent('redo');
                if (isUndoRedo) {
                    return buildTableDecorations(transaction.state);
                }
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

            return buildTableDecorations(transaction.state);
        }

        return decorations;
    },
    provide: (field) => EditorView.decorations.from(field),
});

/**
 * Clears the active cell on undo/redo since position mapping cannot reliably
 * handle structural table changes (row/column add/delete).
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
    return { effects: clearActiveCellEffect.of(undefined) };
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
            target.closest('.cm-table-widget') ||
            target.closest('.cm-table-cell-editor') ||
            target.closest('.cm-table-floating-toolbar')
        ) {
            return false;
        }

        if (getActiveCell(view.state)) {
            view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
        }

        if (isNestedCellEditorOpen()) {
            closeNestedCellEditor();
        }

        return false;
    },
});

const tableWidgetInteractionHandlers = EditorView.domEventHandlers({
    mousedown: (event, view) => {
        return handleTableInteraction(view, event);
    },
});

const nestedEditorLifecyclePlugin = ViewPlugin.fromClass(
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
                if (isNestedCellEditorOpen()) {
                    closeNestedCellEditor();
                }

                requestAnimationFrame(() => {
                    const widgetDOM = this.view.dom.querySelector(
                        `.cm-table-widget[data-table-from="${activeCell.tableFrom}"]`
                    );
                    if (!widgetDOM) {
                        this.view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
                        return;
                    }

                    const selector =
                        activeCell.section === 'header'
                            ? `th[data-section="header"][data-col="${activeCell.col}"]`
                            : `td[data-section="body"][data-row="${activeCell.row}"][data-col="${activeCell.col}"]`;

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
                closeNestedCellEditor();
            }

            // Main -> subview sync.
            if (update.docChanged && hasActiveCell && activeCell && isNestedCellEditorOpen() && !isSync) {
                applyMainTransactionsToNestedEditor({
                    transactions: update.transactions,
                    cellFrom: activeCell.cellFrom,
                    cellTo: activeCell.cellTo,
                });
            }

            // If the document changed externally while editing but we don't have an open subview,
            // clear state to avoid stale ranges.
            if (update.docChanged && hasActiveCell && activeCell && !isNestedCellEditorOpen() && !isSync) {
                this.view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
            }

            this.hadActiveCell = hasActiveCell;
        }

        destroy(): void {
            closeNestedCellEditor();
        }
    }
);

/**
 * Basic styles for the table widget.
 */
const tableStyles = EditorView.baseTheme({
    '.cm-table-widget': {
        padding: '8px 0',
        position: 'relative',
    },
    '.cm-table-widget-table': {
        borderCollapse: 'collapse',
        width: 'auto',
        fontFamily: 'inherit',
        fontSize: 'inherit',
    },
    '.cm-table-widget-table th, .cm-table-widget-table td': {
        border: '1px solid var(--joplin-divider-color)',
        padding: '8px 12px',
        minWidth: '75px',
        position: 'relative',
    },
    '.cm-table-cell-editor-hidden': {
        // Empty span - no display:none to preserve cursor positioning at boundaries
    },
    '.cm-table-cell-editor': {
        width: '100%',
    },
    '.cm-table-cell-editor .cm-editor': {
        width: '100%',
    },
    '.cm-table-cell-editor .cm-scroller': {
        lineHeight: 'inherit',
        fontFamily: 'inherit',
        fontSize: 'inherit',
    },
    '.cm-table-cell-editor .cm-content': {
        margin: '0',
        padding: '0 !important',
        minHeight: 'unset',
        lineHeight: 'inherit',
        color: 'inherit',
    },
    '.cm-table-cell-editor .cm-line': {
        padding: '0',
    },
    '.cm-table-cell-editor .cm-cursor': {
        borderLeftColor: 'currentColor',
    },
    // Hide the default outline of the nested editor so we can style the cell instead
    '.cm-table-cell-editor .cm-editor.cm-focused': {
        outline: 'none',
    },
    // Style the active cell (td)
    '.cm-table-widget-table td.cm-table-cell-active': {
        // Use a box-shadow or outline that typically sits "inside" or "on" the border
        // absolute positioning an overlay might be cleaner to avoid layout shifts,
        // but a simple outline usually works well for spreadsheets.
        outline: '2px solid var(--joplin-divider-color, #4a90e2)',
        outlineOffset: '-1px', // Draw inside existing border
        zIndex: '5', // Ensure on top of neighbors
    },
    '.cm-table-cell-editor .cm-fat-cursor': {
        backgroundColor: 'currentColor',
        color: 'inherit',
    },
    // Remove margins from rendered markdown elements inside cells
    '.cm-table-widget-table th p, .cm-table-widget-table td p': {
        margin: '0',
    },
    '.cm-table-widget-table th :first-child, .cm-table-widget-table td :first-child': {
        marginTop: '0',
    },
    '.cm-table-widget-table th :last-child, .cm-table-widget-table td :last-child': {
        marginBottom: '0',
    },
    // Inline code styling
    '.cm-table-widget-table code': {
        backgroundColor: 'var(--joplin-code-background-color)',
        border: '1px solid var(--joplin-divider-color)',
        color: 'var(--joplin-code-color)',
        padding: '2px 4px',
        borderRadius: '3px',
        fontFamily: 'monospace',
        fontSize: '0.9em',
    },
    // Highlight/mark styling (==text==)
    '.cm-table-widget-table mark': {
        backgroundColor: 'var(--joplin-mark-highlight-background-color)',
        color: 'var(--joplin-mark-highlight-color)',
        padding: '1px 2px',
    },
    // Link styling
    '.cm-table-widget-table a': {
        textDecoration: 'underline',
        color: 'var(--joplin-url-color)',
    },
    '.cm-table-widget-table th': {
        backgroundColor: 'var(--joplin-table-background-color)',
        fontWeight: 'bold',
    },
    '.cm-table-widget-table tr:hover': {
        backgroundColor: 'var(joplin-table-background-color)',
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
            editorControl.addExtension([
                activeCellField,
                createMainEditorActiveCellGuard(isNestedCellEditorOpen),
                clearActiveCellOnUndoRedo,
                tableWidgetInteractionHandlers,
                closeOnOutsideClick,
                nestedEditorLifecyclePlugin,
                tableDecorationField,
                tableStyles,
                tableToolbarTheme,
                tableToolbarPlugin,
            ]);

            // Register command to close nested editor (called from plugin on note switch)
            editorControl.registerCommand('richTablesCloseNestedEditor', () => {
                const view = editorControl.cm6;
                if (isNestedCellEditorOpen()) {
                    closeNestedCellEditor();
                }
                if (getActiveCell(view.state)) {
                    view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
                }

                // Move cursor out of table if inside one (prevents showing raw markdown
                // when Joplin restores cursor position on note switch)
                const tables = findTableRanges(view.state);
                const cursor = view.state.selection.main.head;
                const tableContainingCursor = tables.find((t) => cursor >= t.from && cursor <= t.to);
                if (tableContainingCursor) {
                    // Place cursor just after the table
                    const newPos = Math.min(tableContainingCursor.to + 1, view.state.doc.length);
                    view.dispatch({ selection: { anchor: newPos } });
                }

                return true;
            });

            logger.info('Table widget extension registered');
        },
    };
}
