import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { CLASS_CELL_ACTIVE } from '../shared/tableDomClasses';
import { CELL_COORDS_ATTRIBUTES, CELL_TAGS, CLASS_TABLE_WIDGET_SELECTED, getWidgetSelector } from './domHelpers';
import { JOPLIN_SELECTION_COLORS } from './richTableThemeVars';

/**
 * Rendered cell text whose selection the browser still owns.
 *
 * Dragging across an inactive cell selects its rendered text natively, and pointerup maps that
 * range into the Markdown the cell opens with (`tableRuntime/interaction/mouseCellDragSelection.ts`).
 * That is the one native highlight inside a table widget that has to stay visible, so it is
 * excluded from the two rules that blank the rest:
 *
 * - `:not(.${CLASS_TABLE_WIDGET_SELECTED})` leaves a table the main editor has selected whole to
 *   `wholeTableSelectionVisuals.ts`, which paints the block itself and needs the browser's own
 *   highlight out of the way underneath.
 * - `:not(.${CLASS_CELL_ACTIVE})` leaves the open cell to the nested editor, whose selection
 *   `drawSelection` draws and `nestedEditor/rootEditorSelectionTheme.ts` blanks natively.
 *
 * Being mutually exclusive with both, this rule contends on specificity only with Joplin's own
 * `&.cm-focused ::selection !important`, which it outweighs. The coordinate attributes anchor the
 * chain to the widget's own cells, so a raw HTML table inside a cell's Markdown is reached through
 * the cell that contains it rather than matching on its own.
 */
function renderedCellText(scope: string): string {
    return CELL_TAGS.map(
        (tag) =>
            `${scope} ${getWidgetSelector()}:not(.${CLASS_TABLE_WIDGET_SELECTED}) ` +
            `${tag}${CELL_COORDS_ATTRIBUTES}:not(.${CLASS_CELL_ACTIVE}) ::selection`
    ).join(', ');
}

/**
 * Joplin's focused selection colour, written out rather than read from `--rt-selection-focused-bg`.
 *
 * A highlight pseudo-element inherits through the chain of `::selection` pseudo-elements above it,
 * which bottoms out at the document root; the `--rt-*` variables are defined on the editor root, so
 * they are not reliably visible here. `!important` beats Joplin's own rule, which carries it.
 *
 * Always the focused colour: focus sits on the rendered content during the drag, not the editor,
 * so a focus-dependent fill would read as blurred throughout.
 */
function selectionFill(mode: keyof typeof JOPLIN_SELECTION_COLORS): Record<string, string> {
    return { backgroundColor: `${JOPLIN_SELECTION_COLORS[mode].focused} !important` };
}

/** Paints the browser's own selection over rendered cell text in Joplin's selection colour. */
export const renderedTextSelectionTheme: Extension = EditorView.baseTheme({
    [renderedCellText('&light')]: selectionFill('light'),
    [renderedCellText('&dark')]: selectionFill('dark'),
});
