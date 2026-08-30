import { EditorView } from '@codemirror/view';
import { toggleSourceMode } from '../tableRuntime/sourceModeController';
import { insertTableAndActivate } from '../tableRuntime/operations/structuralOperations';
import { getResolvedActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import { runStructuralAction, type StructuralActionId } from '../tableRuntime/operations/structuralActions';
import { STRUCTURAL_COMMANDS } from '../../contentScriptBridge/structuralCommandCatalog';

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

    for (const { commandName, actionId } of STRUCTURAL_COMMANDS) {
        registerCellCommand(commandName, actionId);
    }

    // Register insert table command that activates the first cell
    editorControl.registerCommand('richTables.insertTableAndActivate', () => {
        return insertTableAndActivate(editorControl.cm6);
    });

    // Register source mode toggle command
    editorControl.registerCommand('richTables.toggleSourceMode', () => {
        return toggleSourceMode(editorControl.cm6);
    });
}
