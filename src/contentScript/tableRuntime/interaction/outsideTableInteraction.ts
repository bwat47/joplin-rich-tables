import type { StateEffect } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { CLASS_CELL_EDITOR } from '../../shared/tableDomClasses';
import { clearActiveCellEffect, getActiveCell } from '../../tableState/activeCellState';
import { clearCellSelectionEffect, getCellSelection } from '../../tableState/cellSelectionState';
import { CLASS_FLOATING_TOOLBAR, getWidgetSelector } from '../../tableWidget/domHelpers';
import { isNestedEditorOpen } from '../../nestedEditor/nestedEditorController';

function getEventTargetElement(event: MouseEvent | PointerEvent): Element | null {
    const target = event.target;
    if (!target) return null;
    if (target instanceof Element) return target;
    if (target instanceof Node) return target.parentElement;
    return null;
}

/** True when the event landed on the table widget, a cell editor, or the floating toolbar. */
function isInsideTableUi(target: Element): boolean {
    return Boolean(
        target.closest(getWidgetSelector()) ||
        target.closest(`.${CLASS_CELL_EDITOR}`) ||
        target.closest(`.${CLASS_FLOATING_TOOLBAR}`)
    );
}

interface OutsideInteractionOptions {
    preserveContextMenu: boolean;
}

/** Whichever pieces of table state an outside interaction would tear down. */
interface LiveTableState {
    hasActiveCell: boolean;
    hasNestedEditor: boolean;
    hasCellSelection: boolean;
}

/** Live table state, or null when nothing is open and the interaction can be ignored. */
function resolveLiveTableState(view: EditorView): LiveTableState | null {
    const live: LiveTableState = {
        hasActiveCell: Boolean(getActiveCell(view.state)),
        hasNestedEditor: isNestedEditorOpen(view),
        hasCellSelection: Boolean(getCellSelection(view.state)),
    };
    if (!live.hasActiveCell && !live.hasNestedEditor && !live.hasCellSelection) {
        return null;
    }
    return live;
}

/** Effects that tear down whichever table selection state is currently live. */
function buildClearEffects(live: LiveTableState): StateEffect<unknown>[] {
    return [
        ...(live.hasActiveCell ? [clearActiveCellEffect.of(undefined)] : []),
        ...(live.hasCellSelection ? [clearCellSelectionEffect.of(undefined)] : []),
    ];
}

/** Moves the caret to the clicked position and clears table state around it. */
function moveCaretAndClearTableState(
    view: EditorView,
    clickPos: number,
    live: LiveTableState,
    options: OutsideInteractionOptions
): void {
    // On right-click context menus, avoid forcing focus/scroll so the native/Joplin
    // menu opens against the expected pointer target without viewport jumps.
    view.dispatch({
        selection: { anchor: clickPos },
        effects: buildClearEffects(live),
        scrollIntoView: !options.preserveContextMenu,
    });
    // A right-click only claims focus when the nested editor we just destroyed held it;
    // otherwise focus stays put so the menu anchors to whatever was clicked.
    if (!options.preserveContextMenu || live.hasNestedEditor) {
        view.focus();
    }
}

/** Fallback when the pointer maps to no document position: clear state, leave the caret alone. */
function clearTableStateInPlace(view: EditorView, live: LiveTableState): void {
    if (!live.hasActiveCell && !live.hasCellSelection) {
        return;
    }
    view.dispatch({ effects: buildClearEffects(live) });
}

function handleOutsideTableInteraction(
    view: EditorView,
    event: MouseEvent | PointerEvent,
    options: OutsideInteractionOptions
): boolean {
    // Keep editor open if interaction is inside the widget or nested editor.
    const target = getEventTargetElement(event);
    if (!target || isInsideTableUi(target)) {
        return false;
    }

    const live = resolveLiveTableState(view);
    if (!live) {
        return false;
    }

    const clickPos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (clickPos === null) {
        clearTableStateInPlace(view, live);
        return false;
    }

    moveCaretAndClearTableState(view, clickPos, live, options);
    // For mousedown, consume only if we positioned the cursor.
    // For contextmenu, never consume so native/Joplin menus can open.
    return !options.preserveContextMenu;
}

export const closeOnOutsideMouseDown = EditorView.domEventHandlers({
    mousedown: (event, view) => {
        return handleOutsideTableInteraction(view, event, { preserveContextMenu: false });
    },
});

export const outsideInteractionCapturePlugin = ViewPlugin.fromClass(
    class {
        private readonly onContextMenu: (event: MouseEvent) => void;

        constructor(private readonly view: EditorView) {
            this.onContextMenu = (event) => {
                // Return value is intentionally ignored for document-level contextmenu.
                // We only need side effects (close/clear), not event consumption control.
                handleOutsideTableInteraction(this.view, event, { preserveContextMenu: true });
            };

            const doc = this.view.dom.ownerDocument;
            // Register on the document in capture phase so outside right-click interactions
            // are seen even when Joplin/Electron context menu handlers intercept later in bubbling.
            doc.addEventListener('contextmenu', this.onContextMenu, true);
        }

        destroy(): void {
            const doc = this.view.dom.ownerDocument;
            doc.removeEventListener('contextmenu', this.onContextMenu, true);
        }
    }
);
