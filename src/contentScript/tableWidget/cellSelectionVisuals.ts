import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { getCellSelection, isCellInRect, toSelectionRect } from '../tableState/cellSelectionState';
import { cellDragField, isCellDragInProgress } from '../tableState/cellDragState';
import {
    CELL_TAGS,
    CLASS_CELL_SELECTED,
    CLASS_TABLE_WIDGET_TABLE,
    SELECTOR_CELL,
    findTableWidgetElement,
    getWidgetSelector,
    readCellCoords,
} from './domHelpers';
import { makeTableId } from '../tableModel/types';
import { measuredClassSyncPlugin } from './measuredClassSync';
import { selectedCellRules } from './selectionTint';

function collectSelectedCells(view: EditorView): HTMLElement[] {
    const selection = getCellSelection(view.state);
    if (!selection) {
        return [];
    }

    const widget = findTableWidgetElement(view, makeTableId(selection.tableFrom));
    if (!widget) {
        return [];
    }

    const rect = toSelectionRect(selection);
    const cells = widget.querySelectorAll<HTMLElement>(SELECTOR_CELL);
    const selectedCells: HTMLElement[] = [];

    for (const cell of cells) {
        const coords = readCellCoords(cell);
        if (!coords || !isCellInRect(rect, coords)) {
            continue;
        }

        selectedCells.push(cell);
    }

    return selectedCells;
}

/** The cells of the current multi-cell selection, optionally suffixed with a pseudo-element. */
const selectedCells = (pseudo = ''): string =>
    CELL_TAGS.map((tag) => `.${CLASS_TABLE_WIDGET_TABLE} ${tag}.${CLASS_CELL_SELECTED}${pseudo}`).join(', ');

/**
 * Paints the selected rectangle in Joplin's selection colour.
 *
 * Deliberately the same fill the main editor's selection puts on a whole table: both are a
 * selection over rendered cells, and telling them apart by colour would say nothing useful. What
 * distinguishes them on screen is their extent — a cell selection stops at the rectangle, while a
 * whole-table selection also floods the widget's own block (`wholeTableSelectionVisuals.ts`).
 */
const cellSelectionFillTheme = EditorView.baseTheme(selectedCellRules(selectedCells));

/** Marks the editor root while a cell drag is sweeping out a rectangle. */
const ATTR_CELL_DRAG = 'data-rt-cell-drag';

/** Puts {@link ATTR_CELL_DRAG} on the editor root for as long as a drag is in progress. */
const cellDragAttribute: Extension = EditorView.editorAttributes.compute(
    [cellDragField],
    (state): Record<string, string> => (isCellDragInProgress(state) ? { [ATTR_CELL_DRAG]: '' } : {})
);

/**
 * Keeps a rectangle being dragged out looking focused.
 *
 * The fill follows the editor's focus (`richTableThemeVars.ts`), and a drag deliberately leaves
 * whatever had focus alone until the rectangle is final — an editor in another table, or
 * something outside the editor entirely — so the selection the user is actively dragging would
 * otherwise render unfocused, and snap to focused on release. A gesture in progress is as focused
 * as a selection gets, whatever the DOM says.
 */
const cellDragFocusOverride: Extension = EditorView.baseTheme({
    [`&[${ATTR_CELL_DRAG}]`]: {
        '--rt-tint': 'var(--rt-tint-focused)',
        '--rt-tint-alpha': 'var(--rt-tint-focused-alpha)',
    } as Record<string, string>,
});

/**
 * Stops a drag that has become a rectangle from also selecting rendered text as it sweeps.
 *
 * The gesture clears its rendered text range on promotion and owns selection until release.
 * Every widget is covered: no other table has a text selection to make during that gesture.
 */
const cellDragTextSelectionSuppression: Extension = EditorView.baseTheme({
    [`&[${ATTR_CELL_DRAG}] ${getWidgetSelector()}`]: { userSelect: 'none' },
});

/** Multi-cell selection visuals: the class on each selected cell, and the fill it carries. */
export const cellSelectionVisuals: Extension = [
    measuredClassSyncPlugin(CLASS_CELL_SELECTED, collectSelectedCells),
    cellSelectionFillTheme,
    cellDragAttribute,
    cellDragFocusOverride,
    cellDragTextSelectionSuppression,
];
