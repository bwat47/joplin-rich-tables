import { StateEffect } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { setActiveCellEffect, type ActiveCell } from '../../tableState/activeCellState';
import { clearCellSelectionEffect } from '../../tableState/cellSelectionState';
import { setPendingNavigationCallback } from '../navigationLock';
import { rememberPendingCellOpen } from '../../nestedEditor/pendingCellOpen';
import type { ResolvedActiveCell } from './activeCellResolver';

export interface OpenActiveCellRequest {
    activeCell: ActiveCell;
    normalizeIfNeeded: boolean;
}

export interface SelectAndRequestOpenActiveCellParams {
    activeCell: ActiveCell;
    clearCellSelection?: boolean;
    normalizeIfNeeded?: boolean;
    initialCursorPos?: 'start' | 'end' | 'lastLineStart';
    onFocused?: () => void;
    selectionAnchor?: number;
    scrollIntoView?: boolean;
    preserveMainSelection?: boolean;
}

export interface PreparedOpenActiveCellTransaction {
    selection?: { anchor: number };
    effects: StateEffect<unknown>[];
}

export const requestOpenActiveCellEffect = StateEffect.define<OpenActiveCellRequest>();

export function prepareOpenActiveCellTransaction(
    view: EditorView,
    params: SelectAndRequestOpenActiveCellParams
): PreparedOpenActiveCellTransaction {
    rememberPendingCellOpen(view, params.activeCell, {
        initialCursorPos: params.initialCursorPos,
    });
    if (params.onFocused) {
        setPendingNavigationCallback(params.onFocused);
    }

    return {
        ...(!params.preserveMainSelection && params.selectionAnchor != null
            ? { selection: { anchor: params.selectionAnchor } }
            : {}),
        effects: [
            ...(params.clearCellSelection ? [clearCellSelectionEffect.of(undefined)] : []),
            setActiveCellEffect.of(params.activeCell),
            requestOpenActiveCellEffect.of({
                activeCell: params.activeCell,
                normalizeIfNeeded: params.normalizeIfNeeded ?? true,
            }),
        ],
    };
}

export function selectAndRequestOpenActiveCell(view: EditorView, params: SelectAndRequestOpenActiveCellParams): void {
    view.dispatch({
        ...prepareOpenActiveCellTransaction(view, params),
        scrollIntoView: params.scrollIntoView ?? false,
    });
}

export function selectAndRequestOpenResolvedActiveCell(
    view: EditorView,
    params: Omit<SelectAndRequestOpenActiveCellParams, 'activeCell' | 'selectionAnchor'> & {
        resolvedCell: ResolvedActiveCell;
    }
): void {
    selectAndRequestOpenActiveCell(view, {
        ...params,
        activeCell: params.resolvedCell.activeCell,
        selectionAnchor: params.resolvedCell.editableFrom,
    });
}
