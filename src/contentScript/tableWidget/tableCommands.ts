import { EditorView } from '@codemirror/view';
import { clearActiveCellEffect, getActiveCell } from './activeCellState';
import { closeNestedCellEditor, isNestedCellEditorOpen } from '../nestedEditor/nestedCellEditor';
import { findTableRanges } from './tablePositioning';
import { runTableOperation } from '../tableModel/tableTransactionHelpers';
import { insertRowForActiveCell, deleteRowForActiveCell } from '../toolbar/tableToolbarSemantics';
import { insertColumn, deleteColumn, updateColumnAlignment } from '../tableModel/markdownTableManipulation';

/**
 * Editor control interface provided by Joplin
 */
interface EditorControl {
    editor: EditorView;
    cm6: EditorView;
    addExtension: (extension: unknown) => void;
    registerCommand: (name: string, callback: (...args: unknown[]) => unknown) => void;
}

export function registerTableCommands(editorControl: EditorControl): void {
    // Register command to close nested editor (called from plugin on note switch)
    editorControl.registerCommand('richTablesCloseNestedEditor', () => {
        const view = editorControl.cm6;
        if (isNestedCellEditorOpen()) {
            closeNestedCellEditor();
        }
        if (getActiveCell(view.state)) {
            view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
        }

        // Move cursor out of table if inside one (prevents showing raw markdown
        // when Joplin restores cursor position on note switch)
        const tables = findTableRanges(view.state);
        const cursor = view.state.selection.main.head;
        const tableContainingCursor = tables.find((t) => cursor >= t.from && cursor <= t.to);
        if (tableContainingCursor) {
            // Place cursor just after the table
            const newPos = Math.min(tableContainingCursor.to + 1, view.state.doc.length);
            view.dispatch({ selection: { anchor: newPos } });
        }

        return true;
    });

    // Register table manipulation commands
    editorControl.registerCommand('richTables.addRowAbove', () => {
        const view = editorControl.cm6;
        const cell = getActiveCell(view.state);
        if (!cell) return false;

        runTableOperation({
            view,
            cell,
            operation: (t, c) => insertRowForActiveCell(t, c, 'before'),
            computeTargetCell: (c) => {
                if (c.section === 'header') {
                    return { section: 'header', row: 0, col: c.col };
                }
                return { section: 'body', row: c.row, col: c.col };
            },
            forceWidgetRebuild: true,
        });
        return true;
    });

    editorControl.registerCommand('richTables.addRowBelow', () => {
        const view = editorControl.cm6;
        const cell = getActiveCell(view.state);
        if (!cell) return false;

        runTableOperation({
            view,
            cell,
            operation: (t, c) => insertRowForActiveCell(t, c, 'after'),
            computeTargetCell: (c) => {
                if (c.section === 'header') {
                    return { section: 'body', row: 0, col: c.col };
                }
                return { section: 'body', row: c.row + 1, col: c.col };
            },
            forceWidgetRebuild: true,
        });
        return true;
    });

    editorControl.registerCommand('richTables.addColumnLeft', () => {
        const view = editorControl.cm6;
        const cell = getActiveCell(view.state);
        if (!cell) return false;

        runTableOperation({
            view,
            cell,
            operation: (t, c) => insertColumn(t, c.col, 'before'),
            computeTargetCell: (c) => ({
                section: c.section,
                row: c.row,
                col: c.col,
            }),
            forceWidgetRebuild: true,
        });
        return true;
    });

    editorControl.registerCommand('richTables.addColumnRight', () => {
        const view = editorControl.cm6;
        const cell = getActiveCell(view.state);
        if (!cell) return false;

        runTableOperation({
            view,
            cell,
            operation: (t, c) => insertColumn(t, c.col, 'after'),
            computeTargetCell: (c) => ({
                section: c.section,
                row: c.row,
                col: c.col + 1,
            }),
            forceWidgetRebuild: true,
        });
        return true;
    });

    editorControl.registerCommand('richTables.deleteRow', () => {
        const view = editorControl.cm6;
        const cell = getActiveCell(view.state);
        if (!cell) return false;

        runTableOperation({
            view,
            cell,
            operation: (t, c) => deleteRowForActiveCell(t, c),
            computeTargetCell: (c) => {
                if (c.section === 'header') {
                    // Header row deleted, first body row promoted
                    return { section: 'header', row: 0, col: c.col };
                }
                const newRow = Math.max(0, c.row - 1);
                return { section: 'body', row: newRow, col: c.col };
            },
            forceWidgetRebuild: true,
        });
        return true;
    });

    editorControl.registerCommand('richTables.deleteColumn', () => {
        const view = editorControl.cm6;
        const cell = getActiveCell(view.state);
        if (!cell) return false;

        runTableOperation({
            view,
            cell,
            operation: (t, c) => deleteColumn(t, c.col),
            computeTargetCell: (c) => {
                const newCol = Math.max(0, c.col - 1);
                return { section: c.section, row: c.row, col: newCol };
            },
            forceWidgetRebuild: true,
        });
        return true;
    });

    editorControl.registerCommand('richTables.alignLeft', () => {
        const view = editorControl.cm6;
        const cell = getActiveCell(view.state);
        if (!cell) return false;

        runTableOperation({
            view,
            cell,
            operation: (t, c) => updateColumnAlignment(t, c.col, 'left'),
            computeTargetCell: (c) => c,
            forceWidgetRebuild: true,
        });
        return true;
    });

    editorControl.registerCommand('richTables.alignRight', () => {
        const view = editorControl.cm6;
        const cell = getActiveCell(view.state);
        if (!cell) return false;

        runTableOperation({
            view,
            cell,
            operation: (t, c) => updateColumnAlignment(t, c.col, 'right'),
            computeTargetCell: (c) => c,
            forceWidgetRebuild: true,
        });
        return true;
    });

    editorControl.registerCommand('richTables.alignCenter', () => {
        const view = editorControl.cm6;
        const cell = getActiveCell(view.state);
        if (!cell) return false;

        runTableOperation({
            view,
            cell,
            operation: (t, c) => updateColumnAlignment(t, c.col, 'center'),
            computeTargetCell: (c) => c,
            forceWidgetRebuild: true,
        });
        return true;
    });
}
