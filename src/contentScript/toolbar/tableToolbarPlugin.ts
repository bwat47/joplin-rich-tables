import { ViewPlugin, ViewUpdate, EditorView } from '@codemirror/view';
import { activeCellField, ActiveCell, clearActiveCellEffect } from '../tableWidget/activeCellState';
import { parseMarkdownTable, TableData } from '../tableModel/markdownTableParsing';
import { insertColumn, deleteColumn, serializeTable } from '../tableModel/markdownTableManipulation';
import { deleteRowForActiveCell, insertRowForActiveCell } from './tableToolbarSemantics';

class TableToolbarPlugin {
    dom: HTMLElement;
    private currentActiveCell: ActiveCell | null = null;

    constructor(private view: EditorView) {
        this.dom = document.createElement('div');
        this.dom.className = 'cm-table-floating-toolbar';
        this.dom.style.position = 'absolute';
        this.dom.style.display = 'none';
        this.dom.style.zIndex = '100'; // Ensure it's above other elements

        // Add buttons
        this.createButtons();

        view.dom.appendChild(this.dom);
    }

    update(update: ViewUpdate) {
        this.currentActiveCell = update.state.field(activeCellField);

        if (this.currentActiveCell) {
            this.showToolbar();
            this.updatePosition();
        } else {
            this.hideToolbar();
        }
    }

    destroy() {
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
        const editorRect = this.view.dom.getBoundingClientRect(); // Use view.dom (container) or view.scrollDOM

        // We want coordinates relative to view.dom, because we appended toolbar to view.dom
        // But view.dom might be relatively positioned.

        // Let's use getBoundingClientRect for layout decisions, but we need to set top/left relative to parent.
        // this.dom is appended to view.dom.
        // view.dom usually has position: relative?

        // Assuming view.dom is the offset parent.
        const parentRect = this.dom.offsetParent?.getBoundingClientRect() || editorRect;

        const widgetRelativeTop = widgetRect.top - parentRect.top;
        const widgetRelativeLeft = widgetRect.left - parentRect.left;
        const widgetHeight = widgetRect.height;

        const toolbarHeight = this.dom.offsetHeight || 30; // Estimate if not rendered yet

        // Visibility Check
        // Is the top of the widget visible?
        const footerVisible = widgetRect.bottom >= editorRect.top && widgetRect.bottom <= editorRect.bottom;

        // Default to top
        let top = widgetRelativeTop - toolbarHeight - 5;

        // If top is not visible (scrolled up) and bottom IS visible, move to bottom
        if (widgetRect.top < editorRect.top && footerVisible) {
            top = widgetRelativeTop + widgetHeight + 5;
        }
        // If both are visible, keep at top?
        // User said: "whatever would be visibible".
        // If top is off-screen (above), and bottom is off-screen (below) - table is huge.
        // We should probably keep it sticky at the top of the VIEWPORT.
        else if (widgetRect.top < editorRect.top && widgetRect.bottom > editorRect.bottom) {
            // Sticky top
            // Relative to parent:
            top = editorRect.top - parentRect.top + 5;
        }

        // Position Left (aligned with table)
        this.dom.style.left = `${widgetRelativeLeft}px`;
        this.dom.style.top = `${top}px`;
    }
}

export const tableToolbarPlugin = ViewPlugin.fromClass(TableToolbarPlugin);
