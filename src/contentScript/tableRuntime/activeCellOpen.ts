import { StateEffect } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { setActiveCellEffect, type ActiveCell } from '../tableState/activeCellState';
import { clearCellSelectionEffect } from '../tableState/cellSelectionState';
import { setPendingNavigationCallback } from './navigationLock';
import { rememberPendingCellOpen } from '../nestedEditor/pendingCellOpen';

export interface OpenActiveCellRequest {
    activeCell: ActiveCell;
    normalizeIfNeeded: boolean;
}

export interface SelectAndRequestOpenActiveCellParams {
    activeCell: ActiveCell;
    clearCellSelection?: boolean;
    normalizeIfNeeded?: boolean;
    initialCursorPos?: 'start' | 'end';
    onFocused?: () => void;
    selectionAnchor?: number;
    scrollIntoView?: boolean;
    preserveMainSelection?: boolean;
}

export const requestOpenActiveCellEffect = StateEffect.define<OpenActiveCellRequest>();

export function selectAndRequestOpenActiveCell(view: EditorView, params: SelectAndRequestOpenActiveCellParams): void {
    rememberPendingCellOpen(view, params.activeCell, {
        initialCursorPos: params.initialCursorPos,
    });
    if (params.onFocused) {
        setPendingNavigationCallback(params.onFocused);
    }

    view.dispatch({
        ...(!params.preserveMainSelection
            ? { selection: { anchor: params.selectionAnchor ?? params.activeCell.anchorPos } }
            : {}),
        effects: [
            ...(params.clearCellSelection ? [clearCellSelectionEffect.of(undefined)] : []),
            setActiveCellEffect.of(params.activeCell),
            requestOpenActiveCellEffect.of({
                activeCell: params.activeCell,
                normalizeIfNeeded: params.normalizeIfNeeded ?? true,
            }),
        ],
        scrollIntoView: params.scrollIntoView ?? false,
    });
}
