import type { EditorState, Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
    CELL_COORDS_ATTRIBUTES,
    CLASS_TABLE_WIDGET_SELECTED,
    CLASS_TABLE_WIDGET_TABLE,
    getWidgetSelector,
} from './domHelpers';
import { findRenderedTablesWithin, type TableSpan } from './tableDecorationField';
import { measuredClassSyncPlugin } from './measuredClassSync';

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
const CELL_TAGS = ['td', 'th'] as const;

/**
 * Selector for the widget's own cells inside a selected table.
 *
 * The coordinate attributes keep it off `td`/`th` belonging to a raw HTML table inside a cell's
 * rendered Markdown, which is content the highlight passes over rather than chrome it owns.
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
 */
const NATIVE_SELECTION_RESET = {
    'background-color': 'transparent !important',
    color: 'inherit !important',
};

/**
 * Lays the selection tint over `base`.
 *
 * `--rt-tint`/`--rt-tint-alpha` describe one layer (see `selectionOverlayColor.ts`), and
 * `color-mix` composites it over whatever it is given: over transparency it is the layer itself,
 * over an opaque colour it is what that colour looks like beneath the layer. That second form is
 * how surfaces the overlay cannot physically cover still get tinted with it.
 */
const tinted = (base: string): string => `color-mix(in srgb, var(--rt-tint) var(--rt-tint-alpha), ${base})`;

/**
 * Paints a table the main editor's selection covers as one selected block.
 *
 * Three layers, because a rendered table has surfaces CodeMirror's own selection background can
 * never reach — it sits behind editor text, while a table carries opaque backgrounds of its own
 * on the header, inline code, `==highlight==` and images.
 *
 * 1. The widget root takes the selection colour outright. It is the block box, so this covers
 *    the widget's padding and the strip beside a narrow table, and being a background rather
 *    than a positioned layer it stays put when a wide table scrolls horizontally.
 * 2. Every cell takes the ground the tint is solved against, replacing the header's own
 *    background. Painting the ground rather than inheriting the theme's is what lets the tint
 *    be exact (see `selectionOverlayColor.ts`).
 * 3. A cell-sized overlay composites that ground up to the selection colour, and takes
 *    everything the cell renders with it. It hangs off the cells because they are already
 *    positioned (`tableStyles.ts`) and scroll with the table; an overlay on the widget root
 *    would be pinned to the scroll origin and slide off a wide table.
 *
 * Cell borders are tinted through their colour rather than by the overlay: they sit outside the
 * padding box it covers, and growing it to reach them would darken every inner border twice,
 * `border-collapse` having made each one shared. Left untinted they all but vanish — the divider
 * colour is a light grey chosen to read on the editor background, and the selection ground is
 * darker than it, dropping a gridline's contrast against its own cell from about 1.36 to 1.06.
 *
 * Painting the block ourselves also frees the highlight from `drawSelection`, whose rects around
 * a rendered table are unreliable: it measures through `coordsAtPos`, which `TableWidget.coordsAt`
 * answers with cell rectangles.
 */
const tableSelectionHighlightTheme = EditorView.baseTheme({
    [`${getWidgetSelector()}::selection`]: NATIVE_SELECTION_RESET,
    [`${getWidgetSelector()} ::selection`]: NATIVE_SELECTION_RESET,
    [`&.cm-focused ${getWidgetSelector()}::selection`]: NATIVE_SELECTION_RESET,
    [`&.cm-focused ${getWidgetSelector()} ::selection`]: NATIVE_SELECTION_RESET,

    // Focus is resolved once, into the tint the rules below read, so nothing else needs a
    // `.cm-focused` copy of itself.
    [SELECTED_WIDGET]: {
        '--rt-tint': 'var(--rt-tint-blurred)',
        '--rt-tint-alpha': 'var(--rt-tint-blurred-alpha)',
        backgroundColor: 'var(--rt-selection-blurred-bg)',
    } as Record<string, string>,
    [`&.cm-focused ${SELECTED_WIDGET}`]: {
        '--rt-tint': 'var(--rt-tint-focused)',
        '--rt-tint-alpha': 'var(--rt-tint-focused-alpha)',
        backgroundColor: 'var(--rt-selection-focused-bg)',
    } as Record<string, string>,

    [selectedCells()]: {
        backgroundColor: 'var(--rt-table-selection-ground-bg)',
        borderColor: tinted('var(--rt-border-color)'),
    },
    [selectedCells('::after')]: {
        content: '""',
        position: 'absolute',
        inset: '0',
        // Above content the cell positions for itself, which would otherwise paint over the fill.
        zIndex: '1',
        backgroundColor: tinted('transparent'),
        pointerEvents: 'none',
    },
});

/** Whole-table selection highlight for tables the main editor's selection covers. */
export const tableSelectionHighlight: Extension = [
    measuredClassSyncPlugin(CLASS_TABLE_WIDGET_SELECTED, collectSelectedTableWidgets),
    tableSelectionHighlightTheme,
];
