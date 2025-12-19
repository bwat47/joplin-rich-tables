import { ViewPlugin, ViewUpdate, EditorView } from '@codemirror/view';
import type { StateEffect } from '@codemirror/state';
import {
    activeCellField,
    ActiveCell,
    setActiveCellEffect,
    clearActiveCellEffect,
} from '../tableWidget/activeCellState';
import { parseMarkdownTable, TableData } from '../tableModel/markdownTableParsing';
import {
    insertColumn,
    deleteColumn,
    serializeTable,
    updateColumnAlignment,
} from '../tableModel/markdownTableManipulation';
import { deleteRowForActiveCell, insertRowForActiveCell } from './tableToolbarSemantics';
import { computePosition, autoUpdate, offset, flip, shift, hide } from '@floating-ui/dom';
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

const formatTableIcon = () =>
    createSvg([
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M3 21v-4a4 4 0 1 1 4 4h-4' },
        { d: 'M21 3a16 16 0 0 0 -12.8 10.2' },
        { d: 'M21 3a16 16 0 0 1 -10.2 12.8' },
        { d: 'M10.6 9a9 9 0 0 1 4.4 4.4' },
    ]);

class TableToolbarPlugin {
    dom: HTMLElement;
    private currentActiveCell: ActiveCell | null = null;
    private cleanupAutoUpdate: (() => void) | null = null;

    constructor(private view: EditorView) {
        this.dom = document.createElement('div');
        this.dom.className = 'cm-table-floating-toolbar';
        this.dom.style.position = 'absolute';
        this.dom.style.display = 'none';

        // Add buttons
        this.createButtons();

        view.dom.appendChild(this.dom);

        // Note: No scroll/resize event listeners - autoUpdate handles it
    }

    update(update: ViewUpdate) {
        const prevActiveCell = this.currentActiveCell;
        this.currentActiveCell = update.state.field(activeCellField);

        // Active cell state changed
        if (!!prevActiveCell !== !!this.currentActiveCell) {
            if (this.currentActiveCell) {
                // Defer to next frame to ensure widget DOM is ready
                requestAnimationFrame(() => this.updatePosition());
            } else {
                this.cleanupPositioning();
                // When the toolbar is no longer needed, remove it from layout entirely
                // to avoid any one-frame paint artifacts.
                this.hideToolbarCompletely();
            }
            return;
        }

        // Active cell changed to different table
        if (this.currentActiveCell && prevActiveCell && this.currentActiveCell.tableFrom !== prevActiveCell.tableFrom) {
            // Defer to next frame to ensure new table widget DOM is ready
            requestAnimationFrame(() => this.updatePosition());
            return;
        }

        // Table was modified (rows/columns added/removed) - reposition toolbar
        if (
            this.currentActiveCell &&
            update.transactions.some((tr) => tr.effects.some((e) => e.is(rebuildTableWidgetsEffect)))
        ) {
            // Defer to next frame to ensure rebuilt widget DOM is ready
            requestAnimationFrame(() => this.updatePosition());
        }

        // Note: autoUpdate handles other cases (scroll/resize)
    }

    destroy() {
        this.cleanupPositioning();
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

        // Separator
        const createSeparator = () => {
            const sep = document.createElement('span');
            sep.className = 'cm-table-toolbar-separator';
            this.dom.appendChild(sep);
        };
        createSeparator();

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

        createSeparator();

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

        createSeparator();

        // Format table (re-serialize to normalize whitespace)
        createIconBtn('Format table', 'Format table', formatTableIcon(), () => {
            this.modifyTable({
                // Return a shallow copy to bypass identity check and trigger re-serialization
                operation: (t) => ({ ...t }),
                computeTargetCell: (cell) => ({ section: cell.section, row: cell.row, col: cell.col }),
                forceWidgetRebuild: true,
            });
        });

        // Edit Mode
        createIconBtn('Edit table as markdown', 'Edit table as markdown', editMarkdownIcon(), () => {
            if (this.currentActiveCell) {
                this.view.dispatch({
                    selection: { anchor: this.currentActiveCell.tableFrom },
                    effects: [clearActiveCellEffect.of(undefined)],
                });
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
        // Keep the element measurable for Floating UI.
        this.dom.style.display = 'flex';
        this.dom.style.visibility = 'visible';
    }

    private hideToolbar() {
        // Prefer visibility over display:none while a cell is active so
        // Floating UI can still measure the element.
        this.dom.style.visibility = 'hidden';
    }

    private hideToolbarCompletely() {
        this.dom.style.visibility = 'hidden';
        this.dom.style.display = 'none';
    }

    private prepareToolbarForPositioning() {
        // Floating UI requires the element to be rendered (not display:none).
        // Start hidden to avoid flicker until we have a positioned x/y.
        this.dom.style.display = 'flex';
        this.dom.style.visibility = 'hidden';
        // Defensive: ensure a stable initial layout for measurement.
        if (!this.dom.style.left) this.dom.style.left = '0px';
        if (!this.dom.style.top) this.dom.style.top = '0px';
    }

    private cleanupPositioning() {
        if (this.cleanupAutoUpdate) {
            this.cleanupAutoUpdate();
            this.cleanupAutoUpdate = null;
        }
    }

    private updatePosition() {
        if (!this.currentActiveCell) {
            this.cleanupPositioning();
            this.hideToolbarCompletely();
            return;
        }

        const selector = `.cm-table-widget[data-table-from="${this.currentActiveCell.tableFrom}"]`;
        const referenceElement = this.view.contentDOM.querySelector(selector) as HTMLElement;

        if (!referenceElement) {
            this.cleanupPositioning();
            this.hideToolbarCompletely();
            return;
        }

        this.cleanupPositioning();
        this.prepareToolbarForPositioning();

        this.cleanupAutoUpdate = autoUpdate(
            referenceElement,
            this.dom,
            async () => {
                const currentRef = this.view.contentDOM.querySelector(selector) as HTMLElement;
                if (!currentRef) {
                    // Don't cleanup here - just hide and let the next update() call handle cleanup
                    this.hideToolbar();
                    return;
                }

                // First compute with preferred top placement
                let result = await computePosition(currentRef, this.dom, {
                    placement: 'top-start',
                    middleware: [
                        offset(5),
                        flip({ fallbackPlacements: ['bottom-start', 'top-start'] }),
                        shift({ padding: 5 }),
                        hide(),
                    ],
                });

                // Check if toolbar would be obscured near top of viewport (where Joplin's toolbar lives)
                const obscurationThreshold = 5; // Pixels from top of viewport
                if (result.y < obscurationThreshold) {
                    // Recompute with forced bottom placement
                    result = await computePosition(currentRef, this.dom, {
                        placement: 'bottom-start',
                        middleware: [offset(5), shift({ padding: 5 }), hide()],
                    });
                }

                if (result.middlewareData.hide?.referenceHidden) {
                    this.hideToolbar();
                    return;
                }

                this.showToolbar();
                Object.assign(this.dom.style, {
                    left: `${result.x}px`,
                    top: `${result.y}px`,
                });
            },
            {
                ancestorScroll: true,
                ancestorResize: true,
                elementResize: true,
                layoutShift: true,
                animationFrame: false,
            }
        );
    }
}

export const tableToolbarPlugin = ViewPlugin.fromClass(TableToolbarPlugin);

export const tableToolbarTheme = EditorView.baseTheme({
    '.cm-table-floating-toolbar': {
        position: 'absolute',
        backgroundColor: 'var(--joplin-background-color)',
        border: '1px solid var(--joplin-divider-color)',
        borderRadius: '6px',
        padding: '4px',
        boxShadow: '0 4px 12px var(--joplin-background-color-transparent2)',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '4px',
        alignItems: 'center',
        maxWidth: 'calc(100vw - 16px)',
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
        color: 'var(--joplin-color)',
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
        backgroundColor: 'var(--joplin-selected-color)',
        borderColor: 'var(--joplin-divider-color)',
    },
    '.cm-table-toolbar-separator': {
        width: '1px',
        height: '18px',
        backgroundColor: 'var(--joplin-divider-color)',
        margin: '0 4px',
    },
});
