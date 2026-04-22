import type { EditorView } from '@codemirror/view';
import { CLASS_CELL_EDITOR } from '../shared/tableDomClasses';
import { getActiveCell } from '../tableState/activeCellState';
import { getCellSelection } from '../tableState/cellSelectionState';
import { makeTableId } from '../tableModel/types';
import { CLASS_FLOATING_TOOLBAR, findTableWidgetElement, getWidgetSelector } from './domHelpers';

const activeManagedPointerInteractions = new WeakSet<EditorView>();

function getEventTargetElement(event: MouseEvent | PointerEvent): Element | null {
    const target = event.target;
    if (!target) return null;
    if (target instanceof Element) return target;
    if (target instanceof Node) return target.parentElement;
    return null;
}

function isInteractionWithinActiveWidgetBounds(view: EditorView, event: MouseEvent | PointerEvent): boolean {
    const activeTableFrom = getActiveCell(view.state)?.tableFrom ?? getCellSelection(view.state)?.tableFrom ?? null;
    if (activeTableFrom === null) {
        return false;
    }

    const activeWidget = findTableWidgetElement(view, makeTableId(activeTableFrom));
    if (!activeWidget) {
        return false;
    }

    const rect = activeWidget.getBoundingClientRect();
    return (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
    );
}

export function isInteractionInsideManagedTableUi(view: EditorView, event: MouseEvent | PointerEvent): boolean {
    const target = getEventTargetElement(event);
    if (
        target?.closest(getWidgetSelector()) ||
        target?.closest(`.${CLASS_CELL_EDITOR}`) ||
        target?.closest(`.${CLASS_FLOATING_TOOLBAR}`)
    ) {
        return true;
    }

    // Desktop browsers can report native scrollbar presses with a target outside
    // the widget subtree. Fall back to the active widget bounds so dragging the
    // table's own scrollbar does not tear down the nested editor mid-interaction.
    return isInteractionWithinActiveWidgetBounds(view, event);
}

export function beginManagedTablePointerInteraction(view: EditorView, event: MouseEvent | PointerEvent): void {
    if (isInteractionInsideManagedTableUi(view, event)) {
        activeManagedPointerInteractions.add(view);
    }
}

export function endManagedTablePointerInteraction(view: EditorView): void {
    activeManagedPointerInteractions.delete(view);
}

export function isManagedTablePointerInteractionActive(view: EditorView): boolean {
    return activeManagedPointerInteractions.has(view);
}
