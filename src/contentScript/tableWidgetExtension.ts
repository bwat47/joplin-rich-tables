import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState, Range, StateField } from '@codemirror/state';
import { TableWidget, computeMarkdownTableCellRanges, parseMarkdownTable } from './TableWidget';
import { initRenderer } from './markdownRenderer';
import { logger } from '../logger';
import { activeCellField, clearActiveCellEffect, getActiveCell } from './activeCellState';
import {
    applyMainTransactionsToNestedEditor,
    closeNestedCellEditor,
    isNestedCellEditorOpen,
    syncAnnotation,
} from './nestedCellEditor';

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
}

/**
 * Find table ranges in the document using the syntax tree.
 */
function findTableRanges(state: EditorState): Array<{ from: number; to: number; text: string }> {
    const tables: Array<{ from: number; to: number; text: string }> = [];
    const doc = state.doc;

    // Use ensureSyntaxTree to attempt getting a complete tree (100ms timeout)
    const tree = ensureSyntaxTree(state, state.doc.length, 100);

    if (tree) {
        tree.iterate({
            enter: (node) => {
                if (node.name === 'Table') {
                    const text = doc.sliceString(node.from, node.to);
                    tables.push({ from: node.from, to: node.to, text });
                }
            },
        });
    }

    return tables;
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

    for (const table of tables) {
        // Skip tables where cursor is inside - let user edit raw markdown
        if (cursorInRange(state, table.from, table.to)) {
            continue;
        }

        const tableData = parseMarkdownTable(table.text);
        if (!tableData) {
            continue;
        }

        const cellRanges = computeMarkdownTableCellRanges(table.text);
        const widget = new TableWidget(tableData, table.text, table.from, table.to, cellRanges);
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

        // When active cell is cleared, rebuild to render updated content.
        if (transaction.effects.some((e) => e.is(clearActiveCellEffect))) {
            return buildTableDecorations(transaction.state);
        }

        if (transaction.docChanged) {
            if (activeCell) {
                return decorations.map(transaction.changes);
            }
            return buildTableDecorations(transaction.state);
        }

        // Rebuild decorations when selection changes (enter/exit raw editing mode).
        if (transaction.selection) {
            return buildTableDecorations(transaction.state);
        }

        return decorations;
    },
    provide: (field) => EditorView.decorations.from(field),
});

const closeOnOutsideClick = EditorView.domEventHandlers({
    mousedown: (event, view) => {
        const target = event.target as HTMLElement | null;
        if (!target) {
            return false;
        }

        // Keep editor open if clicking inside the widget or nested editor.
        if (target.closest('.cm-table-widget') || target.closest('.cm-table-cell-editor')) {
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
            if (update.docChanged && hasActiveCell && !isNestedCellEditorOpen() && !isSync) {
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
    '.cm-table-widget-edit-button': {
        position: 'absolute',
        top: '12px',
        right: '4px',
        padding: '2px 6px',
        fontSize: '12px',
        background: 'transparent',
        border: '1px solid transparent',
        borderRadius: '4px',
        cursor: 'pointer',
        opacity: '0.5',
        transition: 'opacity 0.2s, border-color 0.2s',
        zIndex: '10',
    },
    '.cm-table-widget-edit-button:hover': {
        opacity: '1',
        borderColor: '#ccc',
    },
    '&dark .cm-table-widget-edit-button:hover': {
        borderColor: '#555',
    },
    '.cm-table-widget-table': {
        borderCollapse: 'collapse',
        width: '100%',
        fontFamily: 'inherit',
        fontSize: 'inherit',
    },
    '.cm-table-widget-table th, .cm-table-widget-table td': {
        border: '1px solid #ddd',
        padding: '8px 12px',
        minWidth: '100px',
        position: 'relative',
    },
    '.cm-table-cell-editor-hidden': {
        display: 'none',
    },
    '.cm-table-cell-editor': {
        width: '100%',
    },
    '.cm-table-cell-editor .cm-editor': {
        width: '100%',
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
        backgroundColor: 'rgba(0, 0, 0, 0.06)',
        padding: '2px 4px',
        borderRadius: '3px',
        fontFamily: 'monospace',
        fontSize: '0.9em',
    },
    // Highlight/mark styling (==text==)
    '.cm-table-widget-table mark': {
        backgroundColor: '#EED47B',
        color: '#000000',
        padding: '1px 2px',
    },
    // Link styling
    '.cm-table-widget-table a': {
        textDecoration: 'underline',
    },
    '.cm-table-widget-table th': {
        backgroundColor: '#f5f5f5',
        fontWeight: 'bold',
    },
    '.cm-table-widget-table tr:hover': {
        backgroundColor: '#f9f9f9',
    },
    // Dark theme support
    '&dark .cm-table-widget-table th, &dark .cm-table-widget-table td': {
        borderColor: '#444',
    },
    '&dark .cm-table-widget-table th': {
        backgroundColor: '#333',
    },
    '&dark .cm-table-widget-table tr:hover': {
        backgroundColor: '#2a2a2a',
    },
    '&dark .cm-table-widget-table code': {
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
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
                closeOnOutsideClick,
                nestedEditorLifecyclePlugin,
                tableDecorationField,
                tableStyles,
            ]);

            logger.info('Table widget extension registered');
        },
    };
}
