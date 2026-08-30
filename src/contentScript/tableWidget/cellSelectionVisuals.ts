import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { cellSelectionField, getCellSelection, isCellInRect, toSelectionRect } from '../tableState/cellSelectionState';
import { CLASS_CELL_SELECTED, SELECTOR_CELL, findTableWidgetElement, readCellCoords } from './domHelpers';
import { makeTableId } from '../tableModel/types';

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

class CellSelectionVisualsController {
    private selectedCells = new Set<HTMLElement>();
    private destroyed = false;

    constructor(private readonly view: EditorView) {
        this.scheduleSync();
    }

    update(_update: ViewUpdate): void {
        this.scheduleSync();
    }

    destroy(): void {
        this.destroyed = true;
        this.clear();
    }

    private clear(): void {
        for (const cell of this.selectedCells) {
            cell.classList.remove(CLASS_CELL_SELECTED);
        }
        this.selectedCells.clear();
    }

    private scheduleSync(): void {
        this.view.requestMeasure({
            key: this,
            // Selection rewrites can rebuild the table widget, and ViewPlugin.update()
            // may run before the replacement DOM is mounted. Defer the DOM query/write
            // to the measure phase so the highlight is applied against the current widget.
            read: () => collectSelectedCells(this.view),
            write: (selectedCells: HTMLElement[]) => {
                if (this.destroyed) {
                    return;
                }

                this.clear();

                for (const element of selectedCells) {
                    element.classList.add(CLASS_CELL_SELECTED);
                    this.selectedCells.add(element);
                }
            },
        });
    }
}

export const cellSelectionVisualsPlugin = ViewPlugin.fromClass(CellSelectionVisualsController);

/**
 * Hides the main editor's caret while a cell selection is active.
 *
 * The selection highlight is drawn on the widget's cells, but the real caret stays parked
 * at the focus cell's document position so clipboard and shortcut handling keep working.
 * `TableWidget.coordsAt` maps that position onto the cell's rectangle, so the caret paints
 * inside the rendered table — a blinking insertion point between cells, in a table where
 * typing is not what the selection is for. Suppress it and let the highlight carry the state.
 *
 * `caret-color` covers the browser's native caret; `.cm-cursorLayer` covers the one
 * `drawSelection` paints when the host editor enables it.
 */
export const cellSelectionCaretSuppression: Extension = [
    EditorView.editorAttributes.compute([cellSelectionField], (state): Record<string, string> =>
        getCellSelection(state) ? { 'data-rt-cell-selection': '' } : {}
    ),
    EditorView.baseTheme({
        '&[data-rt-cell-selection] .cm-content': {
            caretColor: 'transparent',
        },
        '&[data-rt-cell-selection] .cm-cursorLayer': {
            display: 'none',
        },
    }),
];
