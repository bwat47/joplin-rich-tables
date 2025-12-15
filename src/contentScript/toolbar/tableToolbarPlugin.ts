import { ViewPlugin, ViewUpdate, EditorView } from '@codemirror/view';
import { activeCellField, ActiveCell, clearActiveCellEffect } from '../tableWidget/activeCellState';
import { parseMarkdownTable, TableData } from '../tableModel/markdownTableParsing';
import { insertColumn, deleteColumn, serializeTable } from '../tableModel/markdownTableManipulation';
import { deleteRowForActiveCell, insertRowForActiveCell } from './tableToolbarSemantics';
import { computeToolbarPosition } from './toolbarPositioning';

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
        const createBtn = (label: string, title: string, onClick: () => void) => {
            const btn = document.createElement('button');
            btn.textContent = label;
            btn.title = title;
            btn.className = 'cm-table-toolbar-btn';
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                onClick();
                this.view.focus(); // Return focus to editor
            };
            this.dom.appendChild(btn);
            return btn;
        };

        // Row Operations
        createBtn('Row+ Before', 'Insert row before', () =>
            this.modifyTable((t, c) => insertRowForActiveCell(t, c, 'before'))
        );
        createBtn('Row+ After', 'Insert row after', () =>
            this.modifyTable((t, c) => insertRowForActiveCell(t, c, 'after'))
        );
        createBtn('Row-', 'Delete row', () => this.modifyTable((t, c) => deleteRowForActiveCell(t, c)));

        // Spacer
        const spacer1 = document.createElement('span');
        spacer1.style.width = '10px';
        spacer1.style.display = 'inline-block';
        this.dom.appendChild(spacer1);

        // Column Operations
        createBtn('Col+ Before', 'Insert column before', () =>
            this.modifyTable((t, c) => insertColumn(t, c.col, 'before'))
        );
        createBtn('Col+ After', 'Insert column after', () =>
            this.modifyTable((t, c) => insertColumn(t, c.col, 'after'))
        );
        createBtn('Col-', 'Delete column', () => this.modifyTable((t, c) => deleteColumn(t, c.col)));

        // Spacer
        const spacer2 = document.createElement('span');
        spacer2.style.width = '10px';
        spacer2.style.display = 'inline-block';
        this.dom.appendChild(spacer2);

        // Edit Mode
        createBtn('📝 Edit Markdown', 'Edit table as markdown', () => {
            if (this.currentActiveCell) {
                this.view.dispatch({ selection: { anchor: this.currentActiveCell.tableFrom } });
            }
        });
    }

    private modifyTable(operation: (table: TableData, cell: ActiveCell) => TableData) {
        if (!this.currentActiveCell) return;

        const { tableFrom, tableTo } = this.currentActiveCell;
        const text = this.view.state.sliceDoc(tableFrom, tableTo);
        const tableData = parseMarkdownTable(text);

        if (!tableData) return;

        const newTableData = operation(tableData, this.currentActiveCell);
        if (newTableData === tableData) {
            return;
        }
        const newText = serializeTable(newTableData);

        this.view.dispatch({
            changes: {
                from: tableFrom,
                to: tableTo,
                insert: newText,
            },
            // Structural edits (row/column changes) can invalidate the active cell's
            // logical meaning. We use the simple policy: exit cell-editing mode.
            effects: clearActiveCellEffect.of(undefined),
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
