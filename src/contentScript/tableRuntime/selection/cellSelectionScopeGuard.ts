import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import { clearCellSelectionEffect, getCellSelection } from '../../tableState/cellSelectionState';
import { requestViewAnimationFrame } from '../../shared/domContext';
import { hasCellSelectionTransitionAnnotation } from '../lifecycle/transactionFactPredicates';
import { resolveContainingTableAtPos } from '../tableResolution';

// The selected table is rendered as a widget, so the syntax tree already covers its start.
// Resolution runs on the keyboard event path and must never block waiting for parse work.
const SELECTION_SCOPE_SYNTAX_TREE_TIMEOUT_MS = 0;

/**
 * True when the caret no longer sits inside the table the cell selection belongs to.
 *
 * An unresolvable table reads as "cannot tell" rather than "left": the selection is stale
 * either way, and clearing it here would pre-empt the paths that already handle a table
 * disappearing out from under a selection.
 */
function selectionLeftSelectedTable(view: EditorView): boolean {
    const cellSelection = getCellSelection(view.state);
    if (!cellSelection) {
        return false;
    }

    const table = resolveContainingTableAtPos(
        view.state,
        cellSelection.tableFrom,
        SELECTION_SCOPE_SYNTAX_TREE_TIMEOUT_MS
    );
    if (!table) {
        return false;
    }

    const { anchor, head } = view.state.selection.main;
    const isInsideTable = (pos: number): boolean => pos >= table.from && pos <= table.to;

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

            // Dispatching during an update is not allowed, so the clear lands on the next frame.
            requestViewAnimationFrame(this.view, () => {
                if (!this.view.dom.isConnected || !selectionLeftSelectedTable(this.view)) {
                    return;
                }

                this.view.dispatch({ effects: clearCellSelectionEffect.of(undefined) });
            });
        }
    }
);
