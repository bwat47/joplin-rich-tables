import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { hostEditorConfigFacet } from '../services/hostEditorConfig';
import {
    CLASS_CELL_ACTIVE,
    CLASS_CELL_CONTENT,
    CLASS_CELL_EDITOR,
    CLASS_CELL_EDITOR_HIDDEN,
} from '../shared/tableDomClasses';
import { CLASS_CELL_SELECTED, CLASS_TABLE_WIDGET_TABLE, getWidgetSelector } from './domHelpers';

/**
 * Width of the gridline between cells.
 *
 * `border-collapse` makes each one shared, so this is the whole line, not a half of one --
 * `selectionTint.ts` redraws a gridline at exactly this width.
 */
export const CELL_BORDER_WIDTH = '1px';

/**
 * Elements inside a widget that keep the cursor the UA gives them.
 *
 * The widget paints a text cursor over its whole box so a drag-selection never flickers between
 * the I-beam and an arrow when it crosses cell padding or a gap between words. These elements are
 * clicked rather than selected, so their cursor still has to say so.
 */
const CURSOR_EXEMPT_SELECTORS = ['button', 'input', 'textarea', 'select', 'summary', 'iframe'] as const;

export const ATTR_ZEBRA_STRIPING = 'data-rt-zebra-striping';

const zebraStripingAttribute = EditorView.editorAttributes.compute(
    [hostEditorConfigFacet],
    (state): Record<string, string> =>
        state.facet(hostEditorConfigFacet).tableAppearance.zebraStriping ? { [ATTR_ZEBRA_STRIPING]: '' } : {}
);

/**
 * Base styles for the table widget, split by responsibility:
 *
 *   1. Widget container and table layout
 *   2. Cell layout and resets
 *   3. Nested editor DOM resets
 *   4. Rendered content styling (markdown output inside cells)
 *   5. Joplin artifact cleanup
 */
const tableTheme = EditorView.baseTheme({
    // -------------------------------------------------------------------------
    // 1. Widget container and table layout
    // -------------------------------------------------------------------------

    [getWidgetSelector()]: {
        // Rendered cells are Markdown output, not laid-out text lines, so `cursor: auto` falls back
        // to an arrow over padding, empty cells and the gaps between inline elements. Declare the
        // text cursor once at the root and let it inherit, so the whole widget reads as selectable.
        cursor: 'text',
        padding: '8px 0',
        position: 'relative',
        display: 'block',
        width: '100%',
        maxWidth: '100%',
        overflowX: 'auto',
        contain: 'inline-size',
    },
    [CURSOR_EXEMPT_SELECTORS.map((selector) => `${getWidgetSelector()} ${selector}`).join(', ')]: {
        cursor: 'default',
    },
    [`${getWidgetSelector()} a[href]`]: {
        cursor: 'pointer',
    },
    [`.${CLASS_TABLE_WIDGET_TABLE}`]: {
        borderCollapse: 'collapse',
        width: 'auto',
        fontFamily: 'inherit',
        fontSize: 'inherit',
    },

    // -------------------------------------------------------------------------
    // 2. Cell layout and resets
    // -------------------------------------------------------------------------

    [`.${CLASS_TABLE_WIDGET_TABLE} th, .${CLASS_TABLE_WIDGET_TABLE} td`]: {
        border: `${CELL_BORDER_WIDTH} solid var(--rt-border-color)`,
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
        paddingLeft: '1px !important',
        whiteSpace: 'normal',
    },
    [`.${CLASS_CELL_EDITOR_HIDDEN}`]: {
        // Empty span - no display:none to preserve cursor positioning at boundaries
    },
    // Style the active cell (td/th)
    [`.${CLASS_TABLE_WIDGET_TABLE} td.${CLASS_CELL_ACTIVE}, .${CLASS_TABLE_WIDGET_TABLE} th.${CLASS_CELL_ACTIVE}`]: {
        outline: '2px solid var(--rt-border-color)',
        outlineOffset: '-1px', // Draw inside existing border
        zIndex: '5', // Ensure on top of neighbors
        wordBreak: 'normal',
        overflowWrap: 'normal',
        boxSizing: 'border-box',
    },
    // -------------------------------------------------------------------------
    // 3. Nested editor DOM resets
    //
    // The nested editor mounts inside a <td>. Its CodeMirror DOM inherits Joplin
    // editor styles that break cell layout; override them here.
    // -------------------------------------------------------------------------

    // Editor host visibility: hidden by default, shown when cell is active.
    // Controlled via CLASS_CELL_ACTIVE on the parent <td>/<th> rather than
    // inline style.display writes in JS.
    [`.${CLASS_CELL_EDITOR}`]: {
        display: 'none',
        width: '100%',
    },
    [`.${CLASS_TABLE_WIDGET_TABLE} td.${CLASS_CELL_ACTIVE} > .${CLASS_CELL_EDITOR}, .${CLASS_TABLE_WIDGET_TABLE} th.${CLASS_CELL_ACTIVE} > .${CLASS_CELL_EDITOR}`]:
        {
            display: 'block',
        },
    [`.${CLASS_TABLE_WIDGET_TABLE} td.${CLASS_CELL_ACTIVE} > .${CLASS_CELL_CONTENT}, .${CLASS_TABLE_WIDGET_TABLE} th.${CLASS_CELL_ACTIVE} > .${CLASS_CELL_CONTENT}`]:
        {
            display: 'none',
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
        margin: '0 !important',
        padding: '0 !important',
        maxWidth: 'none !important',
        minHeight: 'unset',
        lineHeight: 'inherit',
        color: 'inherit',
        // Reset wrapping so the nested editor behaves like the rendered table: wrap at
        // whitespace, don't aggressively split short words, and let a space at a wrap point
        // hang instead of counting toward the cell's intrinsic width (CodeMirror's
        // `lineWrapping` default of `break-spaces` would widen the column on activation).
        whiteSpace: 'pre-wrap',
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
    [`.${CLASS_CELL_EDITOR} .cm-fat-cursor`]: {
        backgroundColor: 'currentColor',
        color: 'inherit',
    },

    // -------------------------------------------------------------------------
    // 4. Rendered content styling (markdown output inside cells)
    // -------------------------------------------------------------------------

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
        backgroundColor: 'var(--rt-code-bg)',
        border: '1px solid var(--rt-border-color)',
        color: 'var(--rt-code-color)',
        padding: '0 2px',
        borderRadius: '3px',
        fontFamily: 'monospace',
        fontSize: '0.9em',
        overflowWrap: 'break-word',
    },
    // Highlight/mark styling (==text==)
    [`.${CLASS_TABLE_WIDGET_TABLE} mark`]: {
        backgroundColor: 'var(--rt-mark-bg)',
        color: 'var(--rt-mark-color)',
        padding: '1px 2px',
    },
    // Link styling
    [`.${CLASS_TABLE_WIDGET_TABLE} a`]: {
        textDecoration: 'underline',
        color: 'var(--rt-link-color)',
        overflowWrap: 'break-word',
    },
    [`.${CLASS_TABLE_WIDGET_TABLE} th`]: {
        backgroundColor: 'var(--rt-header-bg)',
        fontWeight: 'bold',
    },
    // Direct children only, so a stripe never reaches an HTML table rendered inside a cell.
    //
    // Selected cells are excluded rather than left to lose on specificity: this selector outweighs
    // the one `selectionTint.ts` paints a cell selection with, and the tint laid over that cell is
    // pre-solved against `--rt-selection-ground-bg`.  A stripe standing in for the ground would
    // composite to a different colour, banding a selected rectangle row by row.
    [`&[${ATTR_ZEBRA_STRIPING}] .${CLASS_TABLE_WIDGET_TABLE} > tbody > tr:nth-child(even) > td:not(.${CLASS_CELL_SELECTED})`]:
        {
            backgroundColor: 'var(--rt-stripe-bg)',
        },
    // Media constraints - prevent massive videos/images from breaking the table.
    // Scoped to CLASS_CELL_CONTENT to avoid affecting CodeMirror's internal <img class="cm-widgetBuffer"> elements.
    [`.${CLASS_TABLE_WIDGET_TABLE} .${CLASS_CELL_CONTENT} img, .${CLASS_TABLE_WIDGET_TABLE} .${CLASS_CELL_CONTENT} video`]:
        {
            maxWidth: '100%',
            height: 'auto',
        },

    // -------------------------------------------------------------------------
    // 5. Joplin artifact cleanup
    //
    // Rules that neutralize Joplin-injected elements or behaviors that would
    // otherwise break or clutter the table widget.
    // -------------------------------------------------------------------------

    // Hide Joplin's source elements for rendered content (Math, Mermaid, etc.) which cause layout issues
    [`.${CLASS_TABLE_WIDGET_TABLE} .joplin-source`]: {
        display: 'none',
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

export const tableStyles: Extension = [zebraStripingAttribute, tableTheme];
