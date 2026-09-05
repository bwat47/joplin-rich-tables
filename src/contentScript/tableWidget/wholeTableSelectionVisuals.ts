import type { EditorState, Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
    CELL_COORDS_ATTRIBUTES,
    CELL_TAGS,
    CLASS_TABLE_WIDGET_SELECTED,
    CLASS_TABLE_WIDGET_TABLE,
    getWidgetSelector,
} from './domHelpers';
import { findRenderedTablesWithin, type TableSpan } from './tableDecorationField';
import { measuredClassSyncPlugin } from './measuredClassSync';
import { selectedCellRules } from './selectionTint';

/**
 * Rendered tables the main editor's selection covers end to end.
 *
 * Coverage is all-or-nothing by design: a block widget has no meaningful partial selection, and
 * `tableRuntime/selection/tableSelectionSnap.ts` grows any selection that touches a table until
 * it contains the whole thing, so a partially covered table is only ever a transient state.
 *
 * No table can appear twice: selection ranges never overlap, so containing the same table whole
 * would take a range of zero length.
 */
export function findSelectedTableSpans(state: EditorState): TableSpan[] {
    return state.selection.ranges.flatMap((range) =>
        range.empty ? [] : findRenderedTablesWithin(state, range.from, range.to)
    );
}

/**
 * Widget roots for the selected tables.
 *
 * One pass over the mounted widgets rather than a lookup per table: `posAtDOM` is the only
 * trustworthy widget identity (see `findTableWidgetElement`), so scanning once keeps a
 * select-all over a table-heavy note linear in the number of visible widgets.
 */
function collectSelectedTableWidgets(view: EditorView): HTMLElement[] {
    const selectedTableStarts = new Set(findSelectedTableSpans(view.state).map((span) => span.from));
    if (selectedTableStarts.size === 0) {
        return [];
    }

    const selectedWidgets: HTMLElement[] = [];

    for (const widget of view.contentDOM.querySelectorAll<HTMLElement>(getWidgetSelector())) {
        try {
            if (selectedTableStarts.has(view.posAtDOM(widget))) {
                selectedWidgets.push(widget);
            }
        } catch {
            // posAtDOM can fail for widget DOM that is on its way out; skip it.
        }
    }

    return selectedWidgets;
}

const SELECTED_WIDGET = `${getWidgetSelector()}.${CLASS_TABLE_WIDGET_SELECTED}`;
/**
 * Selector for the widget's own cells inside a selected table.
 *
 * The coordinate attributes keep it off `td`/`th` belonging to a raw HTML table inside a cell's
 * rendered Markdown, which is content the selection fill passes over rather than chrome the widget owns.
 */
function selectedCells(pseudo = ''): string {
    return CELL_TAGS.map(
        (tag) => `${SELECTED_WIDGET} .${CLASS_TABLE_WIDGET_TABLE} ${tag}${CELL_COORDS_ATTRIBUTES}${pseudo}`
    ).join(', ');
}

/**
 * Removes the browser's own selection highlight from everything a table widget renders.
 *
 * CodeMirror's `drawSelection` only neutralizes native `::selection` inside `.cm-line`, and a
 * block replace widget is a direct child of `.cm-content`, so the browser paints its own
 * highlight over every run of text in the rendered table — ragged per-word boxes in whatever
 * colour the platform picked.
 *
 * The `&.cm-focused` copies exist for specificity: Joplin's own `&.cm-focused ::selection` rule
 * is two classes with `!important`, so the unfocused rules alone would tie with it and be
 * settled by stylesheet order. Same approach as `nestedEditor/rootEditorSelectionTheme.ts`.
 *
 * The one native highlight that survives this is a text selection dragged out inside a rendered
 * cell, which `renderedTextSelectionTheme.ts` paints instead; its selectors match only cells this
 * one has no fill to protect.
 */
const NATIVE_SELECTION_RESET = {
    'background-color': 'transparent !important',
    color: 'inherit !important',
};

/**
 * Paints a table the main editor's selection covers as one selected block.
 *
 * `selectionTint.ts` paints the cells; the widget root takes the selection colour outright on top
 * of that. The root is the block box, so this covers the widget's padding and the strip beside a
 * narrow table, and being a background rather than a positioned layer it stays put when a wide
 * table scrolls horizontally.
 *
 * Painting the block ourselves also frees the highlight from `drawSelection`, whose rects around
 * a rendered table are unreliable: it measures through `coordsAtPos`, which `TableWidget.coordsAt`
 * answers with cell rectangles.
 */
const wholeTableSelectionTheme = EditorView.baseTheme({
    [`${getWidgetSelector()}::selection`]: NATIVE_SELECTION_RESET,
    [`${getWidgetSelector()} ::selection`]: NATIVE_SELECTION_RESET,
    [`&.cm-focused ${getWidgetSelector()}::selection`]: NATIVE_SELECTION_RESET,
    [`&.cm-focused ${getWidgetSelector()} ::selection`]: NATIVE_SELECTION_RESET,

    [SELECTED_WIDGET]: {
        backgroundColor: 'var(--rt-selection-bg)',
    },

    ...selectedCellRules(selectedCells),
});

/** Whole-table selection visuals for tables the main editor's selection covers end to end. */
export const wholeTableSelectionVisuals: Extension = [
    measuredClassSyncPlugin(CLASS_TABLE_WIDGET_SELECTED, collectSelectedTableWidgets),
    wholeTableSelectionTheme,
];
