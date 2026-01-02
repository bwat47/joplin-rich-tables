import { EditorView } from '@codemirror/view';
import {
    CLASS_CELL_ACTIVE,
    CLASS_CELL_EDITOR,
    CLASS_CELL_EDITOR_HIDDEN,
    CLASS_TABLE_WIDGET_TABLE,
    getWidgetSelector,
} from './domHelpers';

/**
 * Basic styles for the table widget.
 */
export const tableStyles = EditorView.baseTheme({
    [getWidgetSelector()]: {
        padding: '8px 0',
        position: 'relative',
        display: 'block',
        width: '100%',
        maxWidth: '100%',
        overflowX: 'auto',
        contain: 'inline-size',
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
        scrollMargin: '8px',
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
        overflowX: 'hidden',
    },
    [`.${CLASS_CELL_EDITOR} .cm-content`]: {
        margin: '0',
        padding: '0 !important',
        minHeight: 'unset',
        lineHeight: 'inherit',
        color: 'inherit',
        // Ensure long text (URLs, etc.) breaks to wrap within the cell
        overflowWrap: 'break-word',
        wordBreak: 'break-word',
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
        overflowWrap: 'break-word',
        wordBreak: 'break-word',
        boxSizing: 'border-box',
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
        padding: '0 2px',
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
    // Hide Joplin's source elements for rendered content (Math, Mermaid, etc.) which cause layout issues
    [`.${CLASS_TABLE_WIDGET_TABLE} .joplin-source`]: {
        display: 'none',
    },
    // Ensure the container for editable content doesn't break layout
    [`.${CLASS_TABLE_WIDGET_TABLE} .joplin-editable`]: {
        display: 'inline-block',
        maxWidth: '100%',
    },
});
