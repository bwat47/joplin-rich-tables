import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { getCellSelection, isCellInRect, toSelectionRect } from './cellSelectionState';
import { CLASS_CELL_SELECTED, findTableWidgetElement } from './domHelpers';
import { makeTableId, type CellCoords } from '../tableModel/types';

function readCoords(cell: Element): CellCoords | null {
    const section = cell.getAttribute('data-section');
    const row = Number(cell.getAttribute('data-row'));
    const col = Number(cell.getAttribute('data-col'));

    if ((section !== 'header' && section !== 'body') || Number.isNaN(row) || Number.isNaN(col)) {
        return null;
    }

    return { section, row, col };
}

export const cellSelectionVisualsPlugin = ViewPlugin.fromClass(
    class {
        private selectedCells = new Set<HTMLElement>();

        constructor(private readonly view: EditorView) {
            this.sync();
        }

        update(_update: ViewUpdate): void {
            this.sync();
        }

        destroy(): void {
            this.clear();
        }

        private clear(): void {
            for (const cell of this.selectedCells) {
                cell.classList.remove(CLASS_CELL_SELECTED);
            }
            this.selectedCells.clear();
        }

        private sync(): void {
            this.clear();

            const selection = getCellSelection(this.view.state);
            if (!selection) {
                return;
            }

            const widget = findTableWidgetElement(this.view, makeTableId(selection.tableFrom));
            if (!widget) {
                return;
            }

            const rect = toSelectionRect(selection);
            const cells = widget.querySelectorAll('td[data-section][data-row][data-col], th[data-section][data-row][data-col]');

            for (const cell of cells) {
                const coords = readCoords(cell);
                if (!coords || !isCellInRect(rect, coords)) {
                    continue;
                }

                const element = cell as HTMLElement;
                element.classList.add(CLASS_CELL_SELECTED);
                this.selectedCells.add(element);
            }
        }
    }
);
