import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { EditorState, Range, StateField } from '@codemirror/state';
import { TableWidget } from './TableWidget';
import { parseMarkdownTable } from '../tableModel/markdownTableParsing';
import { initRenderer } from '../services/markdownRenderer';
import { logger } from '../../logger';
import { activeCellField, clearActiveCellEffect, getActiveCell } from './activeCellState';
import { rebuildTableWidgetsEffect } from './tableWidgetEffects';
import {
    applyMainSelectionToNestedEditor,
    applyMainTransactionsToNestedEditor,
    closeNestedCellEditor,
    isNestedCellEditorOpen,
    refocusNestedEditor,
    syncAnnotation,
    openNestedCellEditor,
} from '../nestedEditor/nestedCellEditor';
import { createMainEditorActiveCellGuard } from '../nestedEditor/mainEditorGuard';
import { handleTableInteraction } from './tableWidgetInteractions';
import { findTableRanges } from './tablePositioning';
import { tableToolbarPlugin, tableToolbarTheme } from '../toolbar/tableToolbarPlugin';
import { runTableOperation } from '../tableModel/tableTransactionHelpers';
import { insertRowForActiveCell } from '../toolbar/tableToolbarSemantics';
import { insertColumn } from '../tableModel/markdownTableManipulation';
import {
    CLASS_CELL_ACTIVE,
    CLASS_CELL_EDITOR,
    CLASS_CELL_EDITOR_HIDDEN,
    CLASS_TABLE_WIDGET_TABLE,
    CLASS_FLOATING_TOOLBAR,
    SECTION_BODY,
    SECTION_HEADER,
    getCellSelector,
    getWidgetSelector,
} from './domConstants';

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
 * Clears the active cell on undo/redo if the changes affect areas outside
 * the active cell. This handles structural table changes (row/column add/delete)
 * while allowing simple text edits within a cell to undo without rebuilding.
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

    // Check if any changes are outside the active cell range
    let hasChangesOutsideCell = false;
    tr.changes.iterChanges((fromA, toA) => {
        // If change starts before cell or ends after cell, it's outside
        if (fromA < activeCell.cellFrom || toA > activeCell.cellTo) {
            hasChangesOutsideCell = true;
        }
    });

    // Only clear active cell if changes affect the table structure outside the cell
    if (hasChangesOutsideCell) {
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
        const hasNestedEditor = isNestedCellEditorOpen();

        if (!hasActiveCell && !hasNestedEditor) {
            return false;
        }

        // Capture the document position BEFORE we close the nested editor and rebuild
        // decorations. Layout changes from rebuilding decorations would otherwise cause
        // CodeMirror to map screen coordinates to the wrong document position.
        const clickPos = view.posAtCoords({ x: event.clientX, y: event.clientY });

        // Close the nested editor first to ensure widget DOM is cleaned up before rebuild.
        if (hasNestedEditor) {
            closeNestedCellEditor();
        }

        // Combine clearing active cell and setting selection in a single dispatch.
        // Use scrollIntoView: false to prevent CodeMirror's automatic scroll during the
        // decoration rebuild. The rebuild may change widget heights (if cell content was
        // edited), and scrolling during this layout change can cause unexpected jumps.
        if (clickPos !== null) {
            view.dispatch({
                selection: { anchor: clickPos },
                effects: hasActiveCell ? clearActiveCellEffect.of(undefined) : [],
                scrollIntoView: false,
            });
            view.focus();

            // After layout stabilizes, scroll the cursor into view. Using RAF ensures
            // the decoration rebuild has completed and heights are accurate.
            requestAnimationFrame(() => {
                view.dispatch({
                    effects: EditorView.scrollIntoView(clickPos, { y: 'nearest' }),
                });
            });
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
        if (isNestedCellEditorOpen() && getActiveCell(view.state)) {
            refocusNestedEditor();
            return true;
        }
        return false;
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
                    const widgetDOM = this.view.dom.querySelector(getWidgetSelector(activeCell.tableFrom));
                    if (!widgetDOM) {
                        this.view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
                        return;
                    }

                    const selector =
                        activeCell.section === SECTION_HEADER
                            ? getCellSelector(SECTION_HEADER, 0, activeCell.col)
                            : getCellSelector(SECTION_BODY, activeCell.row, activeCell.col);

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
                isNestedCellEditorOpen() &&
                !isSync
            ) {
                applyMainSelectionToNestedEditor({
                    selection: update.state.selection,
                    cellFrom: activeCell.cellFrom,
                    cellTo: activeCell.cellTo,
                    focus: true,
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
    [getWidgetSelector()]: {
        padding: '8px 0',
        position: 'relative',
        display: 'block',
        width: '100%',
        maxWidth: '100%',
        overflowX: 'auto',
        contain: 'inline-size', // <-- explicit size containment
    },
    [`.${CLASS_TABLE_WIDGET_TABLE}`]: {
        borderCollapse: 'collapse',
        width: 'auto',
        fontFamily: 'inherit',
        fontSize: 'inherit',
    },
    [`.${CLASS_TABLE_WIDGET_TABLE} th, .${CLASS_TABLE_WIDGET_TABLE} td`]: {
        border: '1px solid var(--joplin-divider-color, #dddddd)',
        padding: '8px 12px',
        overflowWrap: 'normal',
        wordBreak: 'normal',
        minWidth: '75px',
        position: 'relative',
    },
    [`.${CLASS_CELL_EDITOR_HIDDEN}`]: {
        // Empty span - no display:none to preserve cursor positioning at boundaries
    },
    [`.${CLASS_CELL_EDITOR}`]: {
        width: '100%',
    },
    [`.${CLASS_CELL_EDITOR} .cm-editor`]: {
        width: '100%',
    },
    [`.${CLASS_CELL_EDITOR} .cm-scroller`]: {
        lineHeight: 'inherit',
        fontFamily: 'inherit',
        fontSize: 'inherit',
    },
    [`.${CLASS_CELL_EDITOR} .cm-content`]: {
        margin: '0',
        padding: '0 !important',
        minHeight: 'unset',
        lineHeight: 'inherit',
        color: 'inherit',
    },
    [`.${CLASS_CELL_EDITOR} .cm-line`]: {
        padding: '0',
    },
    [`.${CLASS_CELL_EDITOR} .cm-cursor`]: {
        borderLeftColor: 'currentColor',
    },
    // Hide the default outline of the nested editor so we can style the cell instead
    [`.${CLASS_CELL_EDITOR} .cm-editor.cm-focused`]: {
        outline: 'none',
    },
    // Style the active cell (td)
    [`.${CLASS_TABLE_WIDGET_TABLE} td.${CLASS_CELL_ACTIVE}`]: {
        // Use a box-shadow or outline that typically sits "inside" or "on" the border
        // absolute positioning an overlay might be cleaner to avoid layout shifts,
        // but a simple outline usually works well for spreadsheets.
        outline: '2px solid var(--joplin-divider-color, #dddddd)',
        outlineOffset: '-1px', // Draw inside existing border
        zIndex: '5', // Ensure on top of neighbors
    },
    [`.${CLASS_CELL_EDITOR} .cm-fat-cursor`]: {
        backgroundColor: 'currentColor',
        color: 'inherit',
    },
    // Remove margins from rendered markdown elements inside cells
    [`.${CLASS_TABLE_WIDGET_TABLE} th p, .${CLASS_TABLE_WIDGET_TABLE} td p`]: {
        margin: '0',
    },
    [`.${CLASS_TABLE_WIDGET_TABLE} th :first-child, .${CLASS_TABLE_WIDGET_TABLE} td :first-child`]: {
        marginTop: '0',
    },
    [`.${CLASS_TABLE_WIDGET_TABLE} th :last-child, .${CLASS_TABLE_WIDGET_TABLE} td :last-child`]: {
        marginBottom: '0',
    },
    // Inline code styling
    [`.${CLASS_TABLE_WIDGET_TABLE} code`]: {
        backgroundColor: 'var(--joplin-code-background-color, rgb(243, 243, 243))',
        border: '1px solid var(--joplin-divider-color, #dddddd)',
        color: 'var(--joplin-code-color, rgb(0,0,0))',
        padding: '2px 4px',
        borderRadius: '3px',
        fontFamily: 'monospace',
        fontSize: '0.9em',
    },
    // Highlight/mark styling (==text==)
    [`.${CLASS_TABLE_WIDGET_TABLE} mark`]: {
        backgroundColor: 'var(--joplin-mark-highlight-background-color, #F7D26E)',
        color: 'var(--joplin-mark-highlight-color, black)',
        padding: '1px 2px',
    },
    // Link styling
    [`.${CLASS_TABLE_WIDGET_TABLE} a`]: {
        textDecoration: 'underline',
        color: 'var(--joplin-url-color, #155BDA)',
    },
    [`.${CLASS_TABLE_WIDGET_TABLE} th`]: {
        backgroundColor: 'var(--joplin-table-background-color, rgb(247, 247, 247))',
        fontWeight: 'bold',
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
                nestedEditorFocusGuard,
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

            // Register table manipulation commands
            editorControl.registerCommand('richTables.addRowAbove', () => {
                const view = editorControl.cm6;
                const cell = getActiveCell(view.state);
                if (!cell) return false;

                runTableOperation({
                    view,
                    cell,
                    operation: (t, c) => insertRowForActiveCell(t, c, 'before'),
                    computeTargetCell: (c) => {
                        if (c.section === 'header') {
                            return { section: 'header', row: 0, col: c.col };
                        }
                        return { section: 'body', row: c.row, col: c.col };
                    },
                    forceWidgetRebuild: true,
                });
                return true;
            });

            editorControl.registerCommand('richTables.addRowBelow', () => {
                const view = editorControl.cm6;
                const cell = getActiveCell(view.state);
                if (!cell) return false;

                runTableOperation({
                    view,
                    cell,
                    operation: (t, c) => insertRowForActiveCell(t, c, 'after'),
                    computeTargetCell: (c) => {
                        if (c.section === 'header') {
                            return { section: 'body', row: 0, col: c.col };
                        }
                        return { section: 'body', row: c.row + 1, col: c.col };
                    },
                    forceWidgetRebuild: true,
                });
                return true;
            });

            editorControl.registerCommand('richTables.addColumnLeft', () => {
                const view = editorControl.cm6;
                const cell = getActiveCell(view.state);
                if (!cell) return false;

                runTableOperation({
                    view,
                    cell,
                    operation: (t, c) => insertColumn(t, c.col, 'before'),
                    computeTargetCell: (c) => ({
                        section: c.section,
                        row: c.row,
                        col: c.col,
                    }),
                    forceWidgetRebuild: true,
                });
                return true;
            });

            editorControl.registerCommand('richTables.addColumnRight', () => {
                const view = editorControl.cm6;
                const cell = getActiveCell(view.state);
                if (!cell) return false;

                runTableOperation({
                    view,
                    cell,
                    operation: (t, c) => insertColumn(t, c.col, 'after'),
                    computeTargetCell: (c) => ({
                        section: c.section,
                        row: c.row,
                        col: c.col + 1,
                    }),
                    forceWidgetRebuild: true,
                });
                return true;
            });

            logger.info('Table widget extension registered');
        },
    };
}
