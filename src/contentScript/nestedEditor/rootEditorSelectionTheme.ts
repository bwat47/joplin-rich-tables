import { EditorView } from '@codemirror/view';
import { activeCellField, getActiveCell } from '../tableState/activeCellState';
import { CLASS_CELL_EDITOR } from '../shared/tableDomClasses';
import { JOPLIN_SELECTION_COLORS } from '../tableWidget/richTableThemeVars';

// Set data-rt-nested-active on Joplin's root .cm-editor when a cell is being edited.
// This attribute lets the painting theme below scope its selectors from the root.
export const rootEditorActiveCellAttribute = EditorView.editorAttributes.compute(
    [activeCellField],
    (state): Record<string, string> => (getActiveCell(state) ? { 'data-rt-nested-active': '' } : {})
);

/** The open cell's editor, reached from the root editor that owns it. */
const OPEN_CELL_EDITOR = `[data-rt-nested-active] .${CLASS_CELL_EDITOR}`;

/** The nested editor's own focused class, which outranks the blurred rule on specificity. */
const NESTED_EDITOR_FOCUSED = '.cm-editor.cm-focused';

/**
 * `::selection` selectors for the open cell's text.
 *
 * Two forms, because a highlight pseudo-element inherits down the tree but loses to a rule
 * matching the element that owns the text: `.cm-content::selection` alone would be overruled on
 * every span inside a line.
 */
function openCellText(scope: string, focused: boolean): string {
    const editor = focused ? `${NESTED_EDITOR_FOCUSED} ` : '';
    const content = `${scope}${OPEN_CELL_EDITOR} ${editor}.cm-content`;

    return `${content}::selection, ${content} *::selection`;
}

/**
 * Joplin's selection colours, written out rather than read from `--rt-selection-*-bg` for the
 * reason `tableWidget/renderedTextSelectionTheme.ts` gives: a highlight pseudo-element cannot
 * see custom properties defined on the editor root.
 */
function selectionFill(
    mode: keyof typeof JOPLIN_SELECTION_COLORS,
    focus: keyof (typeof JOPLIN_SELECTION_COLORS)['light']
): Record<string, string> {
    return {
        backgroundColor: `${JOPLIN_SELECTION_COLORS[mode][focus]} !important`,
        color: 'inherit !important',
    };
}

/**
 * Paints the open cell's text selection with the browser's own highlight.
 *
 * The nested editor's `drawSelection` selection layer is hidden (`nestedEditorTheme.ts`), so the
 * cell being edited and the rendered cells around it are highlighted by the same engine. Line-box
 * rectangles are what an editor wants and what a table cell does not: a range spanning a line
 * break runs them to the far edge of the cell to show that the break is selected, whereas the
 * rendered cell selections stop at the last glyph.
 *
 * Registered on the root editor so `&` resolves to Joplin's .cm-editor, giving each selector one
 * attribute and three or five classes -- enough to beat both Joplin's cascading
 * `&.cm-focused ::selection` rule and the `::selection` blanking that `drawSelection` installs at
 * `Prec.highest`, either of which carries `!important`.
 */
export const rootEditorSelectionPainting = EditorView.baseTheme({
    [openCellText('&light', false)]: selectionFill('light', 'blurred'),
    [openCellText('&light', true)]: selectionFill('light', 'focused'),
    [openCellText('&dark', false)]: selectionFill('dark', 'blurred'),
    [openCellText('&dark', true)]: selectionFill('dark', 'focused'),
});
