import type { StructuralActionId } from '../contentScript/tableRuntime/operations/structuralActions';

/**
 * Single source of truth for the structural table commands, shared by the Joplin host
 * (`src/index.ts`) and the CodeMirror content script (`tableCommands.ts`).
 *
 * The host command name is the same string the host forwards through `editor.execCommand`,
 * so both sides must register it. Deriving both registrations from this catalog keeps them
 * from drifting; the boundary is a plain string that no type check can span.
 *
 * Command names are persisted in the user's Joplin keymap - renaming one orphans their
 * custom shortcut.
 */
interface StructuralCommandDescriptor {
    /** Registered on the host and on the editor. Treat as a stable public identifier. */
    commandName: string;
    /** Shown in the command palette, keyboard shortcut settings, and Tools menu. */
    label: string;
    /** Default Tools menu accelerator. Omitted commands ship without a binding. */
    accelerator?: string;
}

export interface StructuralCommandEntry extends StructuralCommandDescriptor {
    actionId: StructuralActionId;
}

/**
 * Keyed by action id so adding a `StructuralActionId` fails to compile until it has a command.
 * Declaration order drives both the Tools menu and registration order.
 */
const structuralCommands = {
    insertRowBefore: {
        commandName: 'richTables.addRowAbove',
        label: 'Insert row above',
        accelerator: 'Alt+Shift+Up',
    },
    insertRowAfter: {
        commandName: 'richTables.addRowBelow',
        label: 'Insert row below',
        accelerator: 'Alt+Shift+Down',
    },
    insertColumnBefore: {
        commandName: 'richTables.addColumnLeft',
        label: 'Insert column left',
        accelerator: 'Alt+Shift+Left',
    },
    insertColumnAfter: {
        commandName: 'richTables.addColumnRight',
        label: 'Insert column right',
        accelerator: 'Alt+Shift+Right',
    },
    deleteRow: {
        commandName: 'richTables.deleteRow',
        label: 'Delete row',
        accelerator: 'Alt+Shift+D',
    },
    clearRow: {
        commandName: 'richTables.clearRow',
        label: 'Clear row',
        accelerator: 'Alt+Shift+C',
    },
    deleteColumn: {
        commandName: 'richTables.deleteColumn',
        label: 'Delete column',
        accelerator: 'CmdOrCtrl+Alt+Shift+D',
    },
    clearColumn: {
        commandName: 'richTables.clearColumn',
        label: 'Clear column',
        accelerator: 'CmdOrCtrl+Alt+Shift+C',
    },
    alignLeft: {
        commandName: 'richTables.alignLeft',
        label: 'Align column left',
        accelerator: 'Alt+Shift+Q',
    },
    alignCenter: {
        commandName: 'richTables.alignCenter',
        label: 'Align column center',
        accelerator: 'Alt+Shift+W',
    },
    alignRight: {
        commandName: 'richTables.alignRight',
        label: 'Align column right',
        accelerator: 'Alt+Shift+E',
    },
    moveRowUp: {
        commandName: 'richTables.moveRowUp',
        label: 'Move row up',
        accelerator: 'CmdOrCtrl+Alt+Up',
    },
    moveRowDown: {
        commandName: 'richTables.moveRowDown',
        label: 'Move row down',
        accelerator: 'CmdOrCtrl+Alt+Down',
    },
    moveColumnLeft: {
        commandName: 'richTables.moveColumnLeft',
        label: 'Move column left',
        accelerator: 'CmdOrCtrl+Alt+Left',
    },
    moveColumnRight: {
        commandName: 'richTables.moveColumnRight',
        label: 'Move column right',
        accelerator: 'CmdOrCtrl+Alt+Right',
    },
    clearTable: {
        commandName: 'richTables.clearTable',
        label: 'Clear table',
    },
    deleteTable: {
        commandName: 'richTables.deleteTable',
        label: 'Delete table',
    },
    sortColumnAscending: {
        commandName: 'richTables.sortColumnAscending',
        label: 'Sort column (A to Z)',
    },
    sortColumnDescending: {
        commandName: 'richTables.sortColumnDescending',
        label: 'Sort column (Z to A)',
    },
} satisfies Record<StructuralActionId, StructuralCommandDescriptor>;

export const STRUCTURAL_COMMANDS: readonly StructuralCommandEntry[] = (
    Object.keys(structuralCommands) as StructuralActionId[]
).map((actionId) => ({ actionId, ...structuralCommands[actionId] }));
