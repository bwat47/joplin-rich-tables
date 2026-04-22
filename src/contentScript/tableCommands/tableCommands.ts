import { EditorView } from '@codemirror/view';
import { getActiveCell, type ActiveCell } from '../tableState/activeCellState';
import { toggleSourceMode } from '../tableRuntime/sourceModeController';
import {
    clearColumn,
    clearRow,
    clearTable,
    deleteColumn,
    deleteRow,
    deleteTable,
    insertColumnLeft,
    insertColumnRight,
    insertRowAbove,
    insertRowBelow,
    moveColumnLeft,
    moveColumnRight,
    moveRowDown,
    moveRowUp,
    updateAlignment,
    insertTableAndActivate,
} from '../tableRuntime/operations/structuralOperations';

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
    registerCellCommand('richTables.addRowAbove', insertRowAbove);
    registerCellCommand('richTables.addRowBelow', insertRowBelow);
    registerCellCommand('richTables.addColumnLeft', insertColumnLeft);
    registerCellCommand('richTables.addColumnRight', insertColumnRight);
    registerCellCommand('richTables.deleteRow', deleteRow);
    registerCellCommand('richTables.deleteColumn', deleteColumn);

    registerCellCommand('richTables.alignLeft', (v, c) => updateAlignment(v, c, 'left'));
    registerCellCommand('richTables.alignRight', (v, c) => updateAlignment(v, c, 'right'));
    registerCellCommand('richTables.alignCenter', (v, c) => updateAlignment(v, c, 'center'));

    registerCellCommand('richTables.moveRowUp', moveRowUp);
    registerCellCommand('richTables.moveRowDown', moveRowDown);
    registerCellCommand('richTables.moveColumnLeft', moveColumnLeft);
    registerCellCommand('richTables.moveColumnRight', moveColumnRight);

    registerCellCommand('richTables.clearRow', clearRow);
    registerCellCommand('richTables.clearColumn', clearColumn);
    registerCellCommand('richTables.clearTable', clearTable);
    registerCellCommand('richTables.deleteTable', deleteTable);

    // Register insert table command that activates the first cell
    editorControl.registerCommand('richTables.insertTableAndActivate', () => {
        return insertTableAndActivate(editorControl.cm6);
    });

    // Register source mode toggle command
    editorControl.registerCommand('richTables.toggleSourceMode', () => {
        return toggleSourceMode(editorControl.cm6);
    });
}
