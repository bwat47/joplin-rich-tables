import { EditorView } from '@codemirror/view';
import { toggleSourceMode } from '../tableRuntime/sourceModeController';
import { insertTableAndActivate } from '../tableRuntime/operations/structuralOperations';
import { getResolvedActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import { runStructuralAction, type StructuralActionId } from '../tableRuntime/operations/structuralActions';

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
    const registerCellCommand = (name: string, actionId: StructuralActionId) => {
        editorControl.registerCommand(name, () => {
            const resolvedCell = getResolvedActiveCell(editorControl.cm6.state);
            if (!resolvedCell) return false;
            return runStructuralAction(editorControl.cm6, actionId, resolvedCell);
        });
    };

    // Register table manipulation commands
    registerCellCommand('richTables.addRowAbove', 'insertRowBefore');
    registerCellCommand('richTables.addRowBelow', 'insertRowAfter');
    registerCellCommand('richTables.addColumnLeft', 'insertColumnBefore');
    registerCellCommand('richTables.addColumnRight', 'insertColumnAfter');
    registerCellCommand('richTables.deleteRow', 'deleteRow');
    registerCellCommand('richTables.deleteColumn', 'deleteColumn');

    registerCellCommand('richTables.alignLeft', 'alignLeft');
    registerCellCommand('richTables.alignRight', 'alignRight');
    registerCellCommand('richTables.alignCenter', 'alignCenter');

    registerCellCommand('richTables.moveRowUp', 'moveRowUp');
    registerCellCommand('richTables.moveRowDown', 'moveRowDown');
    registerCellCommand('richTables.moveColumnLeft', 'moveColumnLeft');
    registerCellCommand('richTables.moveColumnRight', 'moveColumnRight');

    registerCellCommand('richTables.clearRow', 'clearRow');
    registerCellCommand('richTables.clearColumn', 'clearColumn');
    registerCellCommand('richTables.clearTable', 'clearTable');
    registerCellCommand('richTables.deleteTable', 'deleteTable');

    // Register insert table command that activates the first cell
    editorControl.registerCommand('richTables.insertTableAndActivate', () => {
        return insertTableAndActivate(editorControl.cm6);
    });

    // Register source mode toggle command
    editorControl.registerCommand('richTables.toggleSourceMode', () => {
        return toggleSourceMode(editorControl.cm6);
    });
}
