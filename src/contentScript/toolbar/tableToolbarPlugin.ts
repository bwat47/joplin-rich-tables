import { ViewPlugin, ViewUpdate, EditorView } from '@codemirror/view';
import type { StateEffect } from '@codemirror/state';
import { activeCellField, ActiveCell, setActiveCellEffect } from '../tableWidget/activeCellState';
import { parseMarkdownTable, TableData } from '../tableModel/markdownTableParsing';
import {
    insertColumn,
    deleteColumn,
    serializeTable,
    updateColumnAlignment,
} from '../tableModel/markdownTableManipulation';
import { deleteRowForActiveCell, insertRowForActiveCell } from './tableToolbarSemantics';
import { computeToolbarPosition } from './toolbarPositioning';
import { rebuildTableWidgetsEffect } from '../tableWidget/tableWidgetEffects';
import { computeActiveCellForTableText, type TargetCell } from './tableToolbarActiveCell';

const createSvg = (paths: Array<{ d: string; fill?: string; stroke?: string }>) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.classList.add('cm-table-toolbar-icon');

    for (const pathSpec of paths) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathSpec.d);
        if (pathSpec.fill) path.setAttribute('fill', pathSpec.fill);
        if (pathSpec.stroke) path.setAttribute('stroke', pathSpec.stroke);
        svg.appendChild(path);
    }

    return svg;
};

// Tabler icons
const rowInsertTopIcon = () =>
    createSvg([
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M4 18v-4a1 1 0 0 1 1 -1h14a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-14a1 1 0 0 1 -1 -1z' },
        { d: 'M12 9v-4' },
        { d: 'M10 7l4 0' },
    ]);

const rowInsertBottomIcon = () =>
    createSvg([
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M20 6v4a1 1 0 0 1 -1 1h-14a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h14a1 1 0 0 1 1 1z' },
        { d: 'M12 15l0 4' },
        { d: 'M14 17l-4 0' },
    ]);

const rowRemoveIcon = () =>
    createSvg([
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M20 6v4a1 1 0 0 1 -1 1h-14a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h14a1 1 0 0 1 1 1z' },
        { d: 'M10 16l4 4' },
        { d: 'M10 20l4 -4' },
    ]);

const columnInsertLeftIcon = () =>
    createSvg([
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-14a1 1 0 0 1 1 -1z' },
        { d: 'M5 12l4 0' },
        { d: 'M7 10l0 4' },
    ]);

const columnInsertRightIcon = () =>
    createSvg([
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M6 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-14a1 1 0 0 1 1 -1z' },
        { d: 'M15 12l4 0' },
        { d: 'M17 10l0 4' },
    ]);

const columnRemoveIcon = () =>
    createSvg([
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M6 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-14a1 1 0 0 1 1 -1z' },
        { d: 'M16 10l4 4' },
        { d: 'M16 14l4 -4' },
    ]);

const editMarkdownIcon = () =>
    createSvg([
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M7 7h-1a2 2 0 0 0 -2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2 -2v-1' },
        { d: 'M20.385 6.585a2.1 2.1 0 0 0 -2.97 -2.97l-8.415 8.385v3h3l8.385 -8.415z' },
        { d: 'M16 5l3 3' },
    ]);

const alignLeftIcon = () =>
    createSvg([
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M4 6l16 0' },
        { d: 'M4 12l10 0' },
        { d: 'M4 18l14 0' },
    ]);

const alignCenterIcon = () =>
    createSvg([
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M4 6l16 0' },
        { d: 'M8 12l8 0' },
        { d: 'M6 18l12 0' },
    ]);

const alignRightIcon = () =>
    createSvg([
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M4 6l16 0' },
        { d: 'M10 12l10 0' },
        { d: 'M6 18l14 0' },
    ]);

class TableToolbarPlugin {
    dom: HTMLElement;
    private currentActiveCell: ActiveCell | null = null;
    private rafId: number | null = null;
    private readonly schedulePositionUpdate: () => void;

    constructor(private view: EditorView) {
        this.dom = document.createElement('div');
        this.dom.className = 'cm-table-floating-toolbar';
        this.dom.style.position = 'absolute';
        this.dom.style.display = 'none';

        this.schedulePositionUpdate = () => {
            if (!this.currentActiveCell) {
                return;
            }

            if (this.rafId !== null) {
                return;
            }

            this.rafId = window.requestAnimationFrame(() => {
                this.rafId = null;
                if (this.currentActiveCell) {
                    this.updatePosition();
                }
            });
        };

        // Add buttons
        this.createButtons();

        view.dom.appendChild(this.dom);

        // Keep toolbar position in sync with scrolling and window resizing.
        view.scrollDOM.addEventListener('scroll', this.schedulePositionUpdate, { passive: true });
        window.addEventListener('resize', this.schedulePositionUpdate, { passive: true });
    }

    update(update: ViewUpdate) {
        this.currentActiveCell = update.state.field(activeCellField);

        if (this.currentActiveCell) {
            this.showToolbar();
            this.schedulePositionUpdate();
        } else {
            this.hideToolbar();
        }
    }

    destroy() {
        this.view.scrollDOM.removeEventListener('scroll', this.schedulePositionUpdate);
        window.removeEventListener('resize', this.schedulePositionUpdate);

        if (this.rafId !== null) {
            window.cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.dom.remove();
    }

    private createButtons() {
        const createIconBtn = (title: string, ariaLabel: string, svg: SVGSVGElement, onClick: () => void) => {
            const btn = document.createElement('button');
            btn.title = title;
            btn.className = 'cm-table-toolbar-btn';
            btn.type = 'button';
            btn.setAttribute('aria-label', ariaLabel);
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                onClick();
                this.view.focus();
            };
            btn.appendChild(svg);
            this.dom.appendChild(btn);
            return btn;
        };

        // Row Operations
        createIconBtn('Insert row before', 'Insert row before', rowInsertTopIcon(), () => {
            this.modifyTable({
                operation: (t, c) => insertRowForActiveCell(t, c, 'before'),
                computeTargetCell: (cell) => {
                    if (cell.section === 'header') {
                        // Header insert-before creates a new header row.
                        return { section: 'header', row: 0, col: cell.col };
                    }
                    // New row inserted at current row index.
                    return { section: 'body', row: cell.row, col: cell.col };
                },
                forceWidgetRebuild: true,
            });
        });
        createIconBtn('Insert row after', 'Insert row after', rowInsertBottomIcon(), () => {
            this.modifyTable({
                operation: (t, c) => insertRowForActiveCell(t, c, 'after'),
                computeTargetCell: (cell) => {
                    if (cell.section === 'header') {
                        // Header insert-after creates the first body row.
                        return { section: 'body', row: 0, col: cell.col };
                    }
                    return { section: 'body', row: cell.row + 1, col: cell.col };
                },
                forceWidgetRebuild: true,
            });
        });
        createIconBtn('Delete row', 'Delete row', rowRemoveIcon(), () => {
            this.modifyTable({
                operation: (t, c) => deleteRowForActiveCell(t, c),
                computeTargetCell: (cell) => {
                    if (cell.section === 'header') {
                        // Header delete promotes first body row to header.
                        return { section: 'header', row: 0, col: cell.col };
                    }
                    // After deletion, the next row takes the deleted row's index.
                    return { section: 'body', row: cell.row, col: cell.col };
                },
                forceWidgetRebuild: true,
            });
        });

        // Spacer
        const spacer1 = document.createElement('span');
        spacer1.style.width = '10px';
        spacer1.style.display = 'inline-block';
        this.dom.appendChild(spacer1);

        // Column Operations
        createIconBtn('Insert column before', 'Insert column before', columnInsertLeftIcon(), () => {
            this.modifyTable({
                operation: (t, c) => insertColumn(t, c.col, 'before'),
                computeTargetCell: (cell) => ({
                    section: cell.section,
                    row: cell.row,
                    col: cell.col,
                }),
                forceWidgetRebuild: true,
            });
        });
        createIconBtn('Insert column after', 'Insert column after', columnInsertRightIcon(), () => {
            this.modifyTable({
                operation: (t, c) => insertColumn(t, c.col, 'after'),
                computeTargetCell: (cell) => ({
                    section: cell.section,
                    row: cell.row,
                    col: cell.col + 1,
                }),
                forceWidgetRebuild: true,
            });
        });
        createIconBtn('Delete column', 'Delete column', columnRemoveIcon(), () => {
            this.modifyTable({
                operation: (t, c) => deleteColumn(t, c.col),
                computeTargetCell: (cell) => ({
                    section: cell.section,
                    row: cell.row,
                    col: cell.col,
                }),
                forceWidgetRebuild: true,
            });
        });

        // Spacer
        const spacer3 = document.createElement('span');
        spacer3.style.width = '10px';
        spacer3.style.display = 'inline-block';
        this.dom.appendChild(spacer3);

        // Alignment Operations
        createIconBtn('Align left', 'Align column left', alignLeftIcon(), () => {
            this.modifyTable({
                operation: (t, c) => updateColumnAlignment(t, c.col, 'left'),
                // Keep cursor in current cell.
                computeTargetCell: (cell) => ({ section: cell.section, row: cell.row, col: cell.col }),
                forceWidgetRebuild: true,
            });
        });
        createIconBtn('Align center', 'Align column center', alignCenterIcon(), () => {
            this.modifyTable({
                operation: (t, c) => updateColumnAlignment(t, c.col, 'center'),
                computeTargetCell: (cell) => ({ section: cell.section, row: cell.row, col: cell.col }),
                forceWidgetRebuild: true,
            });
        });
        createIconBtn('Align right', 'Align column right', alignRightIcon(), () => {
            this.modifyTable({
                operation: (t, c) => updateColumnAlignment(t, c.col, 'right'),
                computeTargetCell: (cell) => ({ section: cell.section, row: cell.row, col: cell.col }),
                forceWidgetRebuild: true,
            });
        });

        // Spacer
        const spacer2 = document.createElement('span');
        spacer2.style.width = '10px';
        spacer2.style.display = 'inline-block';
        this.dom.appendChild(spacer2);

        // Edit Mode
        createIconBtn('Edit table as markdown', 'Edit table as markdown', editMarkdownIcon(), () => {
            if (this.currentActiveCell) {
                this.view.dispatch({ selection: { anchor: this.currentActiveCell.tableFrom } });
            }
        });
    }

    private modifyTable(params: {
        operation: (table: TableData, cell: ActiveCell) => TableData;
        computeTargetCell: (cell: ActiveCell, oldTable: TableData, newTable: TableData) => TargetCell;
        forceWidgetRebuild: boolean;
    }) {
        if (!this.currentActiveCell) return;

        const { tableFrom, tableTo } = this.currentActiveCell;
        const text = this.view.state.sliceDoc(tableFrom, tableTo);
        const tableData = parseMarkdownTable(text);

        if (!tableData) return;

        const newTableData = params.operation(tableData, this.currentActiveCell);
        if (newTableData === tableData) {
            return;
        }
        const newText = serializeTable(newTableData);

        const target = params.computeTargetCell(this.currentActiveCell, tableData, newTableData);
        const nextActiveCell = computeActiveCellForTableText({ tableFrom, tableText: newText, target });
        if (!nextActiveCell) {
            return;
        }

        const effects: StateEffect<unknown>[] = [setActiveCellEffect.of(nextActiveCell)];
        if (params.forceWidgetRebuild) {
            effects.push(rebuildTableWidgetsEffect.of(undefined));
        }

        this.view.dispatch({
            changes: {
                from: tableFrom,
                to: tableTo,
                insert: newText,
            },
            effects,
        });
    }

    private showToolbar() {
        this.dom.style.display = 'flex';
    }

    private hideToolbar() {
        this.dom.style.display = 'none';
    }

    private updatePosition() {
        if (!this.currentActiveCell) return;

        // Find the table widget element
        const selector = `.cm-table-widget[data-table-from="${this.currentActiveCell.tableFrom}"]`;
        const widgetElement = this.view.contentDOM.querySelector(selector) as HTMLElement;

        if (!widgetElement) return;

        const widgetRect = widgetElement.getBoundingClientRect();
        const viewportRect = this.view.scrollDOM.getBoundingClientRect();

        // Position toolbar relative to its offset parent.
        const parentRect = this.dom.offsetParent?.getBoundingClientRect() || this.view.dom.getBoundingClientRect();

        const toolbarHeight = this.dom.offsetHeight || 30;

        const position = computeToolbarPosition({
            tableRect: widgetRect,
            viewportRect,
            parentRect,
            toolbar: { height: toolbarHeight, width: this.dom.offsetWidth },
            margin: 5,
        });

        if (!position.visible) {
            this.hideToolbar();
            return;
        }

        this.showToolbar();
        this.dom.style.left = `${position.left}px`;
        this.dom.style.top = `${position.top}px`;
    }
}

export const tableToolbarPlugin = ViewPlugin.fromClass(TableToolbarPlugin);

export const tableToolbarTheme = EditorView.baseTheme({
    '.cm-table-floating-toolbar': {
        position: 'absolute',
        backgroundColor: 'var(--joplin-background-color, #ffffff)',
        border: '1px solid var(--joplin-divider-color, #dddddd)',
        borderRadius: '6px',
        padding: '4px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        display: 'flex',
        gap: '4px',
        alignItems: 'center',
        zIndex: '1000',
        fontSize: '13px',
    },
    '.cm-table-toolbar-btn': {
        background: 'none',
        border: '1px solid transparent',
        borderRadius: '4px',
        cursor: 'pointer',
        padding: '4px 8px',
        fontSize: 'inherit',
        color: 'var(--joplin-color, #333333)',
        whiteSpace: 'nowrap',
        transition: 'all 0.2s',
    },
    '.cm-table-toolbar-btn .cm-table-toolbar-icon': {
        width: '18px',
        height: '18px',
        display: 'block',
    },
    '.cm-table-toolbar-btn:has(.cm-table-toolbar-icon)': {
        padding: '4px 6px',
        lineHeight: '0',
    },
    '.cm-table-toolbar-btn:hover': {
        backgroundColor: 'var(--joplin-selected-color, rgba(0,0,0,0.05))', // fallback
        borderColor: 'var(--joplin-divider-color, #cccccc)',
    },
    // Dark mode for toolbar
    '&dark .cm-table-floating-toolbar': {
        backgroundColor: '#2d2d2d',
        borderColor: '#444444',
        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    },
    '&dark .cm-table-toolbar-btn': {
        color: '#dddddd',
    },
    '&dark .cm-table-toolbar-btn:hover': {
        backgroundColor: 'rgba(255,255,255,0.1)',
        borderColor: '#555555',
    },
});
