import { EditorView, Decoration, DecorationSet } from '@codemirror/view';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState, Range, StateField } from '@codemirror/state';
import { TableWidget, parseMarkdownTable } from './TableWidget';
import { initRenderer } from './markdownRenderer';

const PLUGIN_PREFIX = '[RichTables]';

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

        const widget = new TableWidget(tableData, table.text);
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
        console.info(PLUGIN_PREFIX, 'Table decoration field initialized');
        return buildTableDecorations(state);
    },
    update(decorations, transaction) {
        // Rebuild decorations when document or selection changes
        if (transaction.docChanged || transaction.selection) {
            return buildTableDecorations(transaction.state);
        }
        return decorations;
    },
    provide: (field) => EditorView.decorations.from(field),
});

/**
 * Basic styles for the table widget.
 */
const tableStyles = EditorView.baseTheme({
    '.cm-table-widget': {
        padding: '8px 0',
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
    console.info(PLUGIN_PREFIX, 'Content script loaded');

    // Initialize the markdown renderer with postMessage function
    initRenderer(context.postMessage);

    return {
        plugin: (editorControl: EditorControl) => {
            console.info(PLUGIN_PREFIX, 'Registering table widget extension');

            // Check for CM6
            if (!editorControl.cm6) {
                console.warn(PLUGIN_PREFIX, 'CodeMirror 6 not available, skipping');
                return;
            }

            // Register the extension
            editorControl.addExtension([tableDecorationField, tableStyles]);

            console.info(PLUGIN_PREFIX, 'Table widget extension registered');
        },
    };
}
