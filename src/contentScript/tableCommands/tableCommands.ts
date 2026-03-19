import { EditorView } from '@codemirror/view';
import { getActiveCell, type ActiveCell } from '../tableState/activeCellState';
import { toggleSourceMode } from '../tableRuntime/sourceModeController';
import {
    execClearColumn,
    execClearRow,
    execClearTable,
    execDeleteColumn,
    execDeleteRow,
    execDeleteTable,
    execInsertColumnLeft,
    execInsertColumnRight,
    execInsertRowAbove,
    execInsertRowBelow,
    execMoveColumnLeft,
    execMoveColumnRight,
    execMoveRowDown,
    execMoveRowUp,
    execUpdateAlignment,
    insertTableAndActivate,
} from '../tableRuntime/operations/tableOperations';

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
    // Wrapper to reduce boilerplate for commands requiring an active cell
    const registerCellCommand = (name: string, action: (view: EditorView, cell: ActiveCell) => void) => {
        editorControl.registerCommand(name, () => {
            const cell = getActiveCell(editorControl.cm6.state);
            if (!cell) return false;
            action(editorControl.cm6, cell);
            return true;
        });
    };

    // Register table manipulation commands
    registerCellCommand('richTables.addRowAbove', execInsertRowAbove);
    registerCellCommand('richTables.addRowBelow', execInsertRowBelow);
    registerCellCommand('richTables.addColumnLeft', execInsertColumnLeft);
    registerCellCommand('richTables.addColumnRight', execInsertColumnRight);
    registerCellCommand('richTables.deleteRow', execDeleteRow);
    registerCellCommand('richTables.deleteColumn', execDeleteColumn);

    registerCellCommand('richTables.alignLeft', (v, c) => execUpdateAlignment(v, c, 'left'));
    registerCellCommand('richTables.alignRight', (v, c) => execUpdateAlignment(v, c, 'right'));
    registerCellCommand('richTables.alignCenter', (v, c) => execUpdateAlignment(v, c, 'center'));

    registerCellCommand('richTables.moveRowUp', execMoveRowUp);
    registerCellCommand('richTables.moveRowDown', execMoveRowDown);
    registerCellCommand('richTables.moveColumnLeft', execMoveColumnLeft);
    registerCellCommand('richTables.moveColumnRight', execMoveColumnRight);

    registerCellCommand('richTables.clearRow', execClearRow);
    registerCellCommand('richTables.clearColumn', execClearColumn);
    registerCellCommand('richTables.clearTable', execClearTable);
    registerCellCommand('richTables.deleteTable', execDeleteTable);

    // Register insert table command that activates the first cell
    editorControl.registerCommand('richTables.insertTableAndActivate', () => {
        return insertTableAndActivate(editorControl.cm6);
    });

    // Register source mode toggle command
    editorControl.registerCommand('richTables.toggleSourceMode', () => {
        return toggleSourceMode(editorControl.cm6);
    });
}
