import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { getCellSelection, isCellInRect, toSelectionRect } from '../tableState/cellSelectionState';
import {
    CLASS_CELL_SELECTED,
    DATA_COL,
    DATA_ROW,
    DATA_SECTION,
    SECTION_BODY,
    SECTION_HEADER,
    findTableWidgetElement,
} from './domHelpers';
import { makeTableId, type CellCoords, type TableSection } from '../tableModel/types';

/** Narrows a raw `data-section` value to a known table section. */
function isTableSection(value: string | undefined): value is TableSection {
    return value === SECTION_HEADER || value === SECTION_BODY;
}

/** Parses a raw `data-row`/`data-col` value, returning null when it is not a number. */
function readIndex(value: string | undefined): number | null {
    const index = Number(value);
    return Number.isNaN(index) ? null : index;
}

function readCoords(cell: HTMLElement): CellCoords | null {
    const section = cell.dataset[DATA_SECTION];
    const row = readIndex(cell.dataset[DATA_ROW]);
    const col = readIndex(cell.dataset[DATA_COL]);

    if (!isTableSection(section) || row === null || col === null) {
        return null;
    }

    return { section, row, col };
}

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
    const cells = widget.querySelectorAll<HTMLElement>(
        'td[data-section][data-row][data-col], th[data-section][data-row][data-col]'
    );
    const selectedCells: HTMLElement[] = [];

    for (const cell of cells) {
        const coords = readCoords(cell);
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
