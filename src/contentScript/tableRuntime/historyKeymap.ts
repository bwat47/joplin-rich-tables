import { historyKeymap, redo, undo } from '@codemirror/commands';
import { type Command, type EditorView, type KeyBinding } from '@codemirror/view';

type HistoryCommandRunner = (view: EditorView, command: Command) => boolean;

function isUndoRedoBinding(binding: KeyBinding): binding is KeyBinding & { run: Command } {
    return binding.run === undo || binding.run === redo;
}

/**
 * Builds undo/redo bindings from CodeMirror's default `historyKeymap`, keeping its
 * platform keys and `preventDefault` so nested editing and cell selection stay in
 * lockstep with the host editor.
 */
export function createHistoryKeyBindings(runCommand: HistoryCommandRunner, scope?: string): KeyBinding[] {
    return historyKeymap.filter(isUndoRedoBinding).map((binding) => ({
        ...binding,
        run: (view) => runCommand(view, binding.run),
        ...(scope === undefined ? {} : { scope }),
    }));
}
