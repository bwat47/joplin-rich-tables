import { EditorView, Decoration, DecorationSet } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
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
 * Find table ranges in the document using the syntax tree
 * Falls back to regex-based detection if syntax tree doesn't have Table nodes
 */
function findTableRanges(state: EditorState): Array<{ from: number; to: number; text: string }> {
    const tables: Array<{ from: number; to: number; text: string }> = [];
    const doc = state.doc;

    // Try syntax tree first
    let foundInTree = false;
    syntaxTree(state).iterate({
        enter: (node) => {
            if (node.name === 'Table') {
                foundInTree = true;
                const text = doc.sliceString(node.from, node.to);
                tables.push({ from: node.from, to: node.to, text });
            }
        },
    });

    if (foundInTree) {
        return tables;
    }

    // Fallback: regex-based table detection
    // Match lines that look like table rows (contain |)
    const text = doc.toString();
    const lines = text.split('\n');
    let tableStart: number | null = null;
    let tableEnd: number | null = null;
    let currentPos = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineStart = currentPos;
        const lineEnd = currentPos + line.length;

        const isTableLine = line.includes('|') && line.trim().length > 0;

        if (isTableLine) {
            if (tableStart === null) {
                tableStart = lineStart;
            }
            tableEnd = lineEnd;
        } else {
            // End of table block
            if (tableStart !== null && tableEnd !== null) {
                const tableText = text.slice(tableStart, tableEnd);
                // Validate it's actually a table (has separator row)
                if (parseMarkdownTable(tableText)) {
                    tables.push({ from: tableStart, to: tableEnd, text: tableText });
                }
            }
            tableStart = null;
            tableEnd = null;
        }

        currentPos = lineEnd + 1; // +1 for newline
    }

    // Handle table at end of document
    if (tableStart !== null && tableEnd !== null) {
        const tableText = text.slice(tableStart, tableEnd);
        if (parseMarkdownTable(tableText)) {
            tables.push({ from: tableStart, to: tableEnd, text: tableText });
        }
    }

    return tables;
}

/**
 * Check if cursor is inside a given range
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
 * Build decorations for all tables in the document
 * Tables with cursor inside are not decorated (allows editing raw markdown)
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
 * StateField that manages table widget decorations
 * Block decorations MUST be provided via StateField, not ViewPlugin
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
 * Basic styles for the table widget
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
});

/**
 * Content script module export
 */
export default function (context: ContentScriptContext) {
    console.info(PLUGIN_PREFIX, 'Content script loaded');

    // Initialize the markdown renderer with postMessage function
    initRenderer(context.postMessage);

    return {
        plugin: (editorControl: EditorControl) => {
            console.info(PLUGIN_PREFIX, 'Registering table editor extension');

            // Check for CM6
            if (!editorControl.cm6) {
                console.warn(PLUGIN_PREFIX, 'CodeMirror 6 not available, skipping');
                return;
            }

            // Register the extension
            editorControl.addExtension([tableDecorationField, tableStyles]);

            console.info(PLUGIN_PREFIX, 'Table editor extension registered');
        },
    };
}
