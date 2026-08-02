import type { StateEffect } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { focusMainEditorWithoutScroll } from '../../shared/mainEditorFocus';
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

/** Effects that tear down whichever table selection state is currently live. */
function buildClearEffects(hasActiveCell: boolean, hasCellSelection: boolean): StateEffect<unknown>[] {
    return [
        ...(hasActiveCell ? [clearActiveCellEffect.of(undefined)] : []),
        ...(hasCellSelection ? [clearCellSelectionEffect.of(undefined)] : []),
    ];
}

function handleOutsideTableInteraction(
    view: EditorView,
    event: MouseEvent | PointerEvent,
    options: { preserveContextMenu: boolean }
): boolean {
    const target = getEventTargetElement(event);
    if (!target) {
        return false;
    }

    // Keep editor open if interaction is inside the widget or nested editor.
    if (isInsideTableUi(target)) {
        return false;
    }

    const hasActiveCell = Boolean(getActiveCell(view.state));
    const hasNestedEditor = isNestedEditorOpen(view);
    const hasCellSelection = Boolean(getCellSelection(view.state));
    if (!hasActiveCell && !hasNestedEditor && !hasCellSelection) {
        return false;
    }

    const clickPos = view.posAtCoords({ x: event.clientX, y: event.clientY });

    if (clickPos !== null) {
        // On right-click context menus, avoid forcing focus/scroll so the native/Joplin
        // menu opens against the expected pointer target without viewport jumps.
        view.dispatch({
            selection: { anchor: clickPos },
            effects: buildClearEffects(hasActiveCell, hasCellSelection),
            scrollIntoView: !options.preserveContextMenu,
        });
        if (!options.preserveContextMenu) {
            view.focus();
        } else if (hasNestedEditor) {
            // The nested editor we just destroyed held focus; restore it to the
            // main editor without scrolling so the caret is painted.
            focusMainEditorWithoutScroll(view);
        }
    } else if (hasActiveCell || hasCellSelection) {
        view.dispatch({ effects: buildClearEffects(hasActiveCell, hasCellSelection) });
    }

    // For mousedown, consume only if we positioned the cursor.
    // For contextmenu, never consume so native/Joplin menus can open.
    return !options.preserveContextMenu && clickPos !== null;
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
