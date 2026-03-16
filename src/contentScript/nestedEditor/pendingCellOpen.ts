import type { EditorView } from '@codemirror/view';
import { isSameActiveCell, type ActiveCell } from '../tableState/activeCellState';

export interface PendingCellOpenOptions {
    initialCursorPos?: 'start' | 'end';
}

interface PendingCellOpenRequest extends PendingCellOpenOptions {
    activeCell: ActiveCell;
}

const pendingCellOpenRequests = new WeakMap<EditorView, PendingCellOpenRequest>();

export function rememberPendingCellOpen(
    view: EditorView,
    activeCell: ActiveCell,
    options: PendingCellOpenOptions
): void {
    if (!options.initialCursorPos) {
        pendingCellOpenRequests.delete(view);
        return;
    }

    pendingCellOpenRequests.set(view, {
        activeCell,
        initialCursorPos: options.initialCursorPos,
    });
}

export function consumePendingCellOpenOptions(
    view: EditorView,
    activeCell: ActiveCell
): PendingCellOpenOptions | undefined {
    const pending = pendingCellOpenRequests.get(view);
    if (!pending) {
        return undefined;
    }

    if (!isSameActiveCell(pending.activeCell, activeCell)) {
        pendingCellOpenRequests.delete(view);
        return undefined;
    }

    pendingCellOpenRequests.delete(view);
    return {
        initialCursorPos: pending.initialCursorPos,
    };
}

export function clearPendingCellOpen(view: EditorView): void {
    pendingCellOpenRequests.delete(view);
}
