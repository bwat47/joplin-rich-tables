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
 *
 * Fields are copied one by one rather than spread, so inheriting `preventDefault` reads as
 * a decision: the nested editor calls this without a scope, putting these bindings in the
 * ordinary `editor` scope, where an empty-history Mod-Z must still suppress the browser's
 * native undo. A spread would also carry any field a later CodeMirror release adds.
 */
export function createHistoryKeyBindings(runCommand: HistoryCommandRunner, scope?: string): KeyBinding[] {
    return historyKeymap.filter(isUndoRedoBinding).map((binding) => ({
        key: binding.key,
        mac: binding.mac,
        win: binding.win,
        linux: binding.linux,
        preventDefault: binding.preventDefault,
        run: (view) => runCommand(view, binding.run),
        scope,
    }));
}
