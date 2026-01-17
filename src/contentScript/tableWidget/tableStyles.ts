import { EditorView } from '@codemirror/view';
import {
    CLASS_CELL_ACTIVE,
    CLASS_CELL_CONTENT,
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
        minWidth: '75px',
        // Joplin/CodeMirror editor styles can apply aggressive breaking (e.g. `overflow-wrap: anywhere`)
        // which makes even short words wrap. Reset breaking at the cell level so normal text wraps
        // only at whitespace/hyphenation, and opt-in to break-word only for elements that need it.
        wordBreak: 'normal',
        overflowWrap: 'normal',
        position: 'relative',
        scrollMargin: '8px',
    },
    // Keep truly empty cells (no content wrapper yet) at a consistent height
    // with cells that contain a line of text or the caret.
    [`.${CLASS_TABLE_WIDGET_TABLE} td:empty::before, .${CLASS_TABLE_WIDGET_TABLE} th:empty::before`]: {
        content: '"\u00a0"',
        display: 'inline-block',
        lineHeight: 'inherit',
    },
    // Keep empty cells at a consistent height with cells that contain a line of text.
    [`.${CLASS_TABLE_WIDGET_TABLE} .${CLASS_CELL_CONTENT}:empty::before`]: {
        content: '"\u00a0"',
        display: 'inline-block',
    },
    // Reset white-space to prevent newlines in serialized HTML from rendering as gaps
    // (Joplin's editor uses white-space: break-spaces which makes all whitespace visible)
    [`.${CLASS_TABLE_WIDGET_TABLE} .${CLASS_CELL_CONTENT}`]: {
        whiteSpace: 'normal',
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
        // Reset breaking so the nested editor behaves like the rendered table:
        // wrap at whitespace, but don't aggressively split short words.
        wordBreak: 'normal',
        overflowWrap: 'normal',
    },
    [`.${CLASS_CELL_EDITOR} .cm-line`]: {
        padding: '0',
        wordBreak: 'normal',
        overflowWrap: 'normal',
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
        wordBreak: 'normal',
        overflowWrap: 'normal',
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
        overflowWrap: 'break-word',
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
        overflowWrap: 'break-word',
    },
    [`.${CLASS_TABLE_WIDGET_TABLE} th`]: {
        backgroundColor: 'var(--joplin-table-background-color, rgb(247, 247, 247))',
        fontWeight: 'bold',
    },
    // Hide Joplin's source elements for rendered content (Math, Mermaid, etc.) which cause layout issues
    [`.${CLASS_TABLE_WIDGET_TABLE} .joplin-source`]: {
        display: 'none',
    },
    // Media constraints - prevent massive videos/images from breaking the table
    // Scoped to CLASS_CELL_CONTENT to avoid affecting CodeMirror's internal <img class="cm-widgetBuffer"> elements
    [`.${CLASS_TABLE_WIDGET_TABLE} .${CLASS_CELL_CONTENT} img, .${CLASS_TABLE_WIDGET_TABLE} .${CLASS_CELL_CONTENT} video`]:
        {
            maxWidth: '100%',
            height: 'auto',
        },
    // Fix for YouTube/video embeds layout
    [`.${CLASS_TABLE_WIDGET_TABLE} .joplin-youtube-player-rendered`]: {
        margin: '0 !important',
        padding: '0 !important',
        display: 'block',
        width: '100%',
    },
    [`.${CLASS_TABLE_WIDGET_TABLE} .joplin-youtube-player-rendered iframe`]: {
        width: '100%',
        aspectRatio: '16 / 9',
        height: 'auto', // Override fixed height attribute to let aspect-ratio take over
        display: 'block', // Removes inline-block vertical alignment gaps
        margin: '0',
    },
    // Constrain Joplin's resource icons and missing resource placeholders
    [`.${CLASS_TABLE_WIDGET_TABLE} .resource-icon, .${CLASS_TABLE_WIDGET_TABLE} .not-loaded-resource`]: {
        display: 'inline-block',
        maxWidth: '24px',
        maxHeight: '24px',
        overflow: 'hidden',
    },
    [`.${CLASS_TABLE_WIDGET_TABLE} .resource-icon img, .${CLASS_TABLE_WIDGET_TABLE} .not-loaded-resource img`]: {
        maxWidth: '100%',
        maxHeight: '100%', // Ensure it respects the container height
        width: 'auto',
        height: 'auto',
    },
});
