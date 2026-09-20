import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import { clearCellSelectionEffect, getSelectedTable } from '../../tableState/cellSelectionState';
import { hasCellSelectionTransitionAnnotation } from '../lifecycle/transactionFactPredicates';

/**
 * True when the caret no longer sits inside the table the cell selection belongs to.
 *
 * A selection whose table the index cannot resolve yet counts as "cannot tell" rather than
 * "left": parser recovery may resolve the selection without another selection change.
 */
function selectionLeftSelectedTable(view: EditorView): boolean {
    const selected = getSelectedTable(view.state);
    if (!selected) {
        return false;
    }

    const { ctx } = selected;
    const { anchor, head } = view.state.selection.main;
    const isInsideTable = (pos: number): boolean => pos >= ctx.from && pos <= ctx.to;

    return !isInsideTable(anchor) || !isInsideTable(head);
}

/**
 * Drops a cell selection once the caret leaves its table.
 *
 * A cell selection is a highlight drawn over a widget while the real caret is parked inside
 * the table's replaced range. Nothing in CodeMirror ties the two together, so any main-editor
 * command that moves the caret out — Ctrl+Home, PageUp/PageDown, a modified arrow — would
 * otherwise strand the highlight on a table the caret has left.
 *
 * The dedicated selection paths (arrow keys, Escape, delete, activating a cell) clear the
 * selection themselves and mark their transactions with `cellSelectionTransitionAnnotation`,
 * which also covers their own moves of the caret inside the table. This guard is the backstop
 * for everything else.
 */
export const cellSelectionScopeGuard = ViewPlugin.fromClass(
    class {
        constructor(private readonly view: EditorView) {}

        update(update: ViewUpdate): void {
            if (!update.selectionSet || hasCellSelectionTransitionAnnotation(update.transactions)) {
                return;
            }

            if (!selectionLeftSelectedTable(this.view)) {
                return;
            }

            // Dispatching during an update is not allowed. A microtask runs after CodeMirror
            // returns to idle without leaving stale selection state for a full frame.
            queueMicrotask(() => {
                if (!this.view.dom.isConnected || !selectionLeftSelectedTable(this.view)) {
                    return;
                }

                this.view.dispatch({ effects: clearCellSelectionEffect.of(undefined) });
            });
        }
    }
);
