import { StateEffect } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { setActiveCellEffect, type ActiveCell } from '../../tableState/activeCellState';
import { clearCellSelectionEffect } from '../../tableState/cellSelectionState';
import type { ResolvedActiveCell } from './activeCellResolver';
import { beginOpenCellRequestEffect, createOpenCellRequestId, type OpenCellRequest } from '../openCellRequest';

export interface OpenActiveCellRequestSignal {
    requestId: string;
}

export interface SelectAndRequestOpenActiveCellParams {
    activeCell: ActiveCell;
    clearCellSelection?: boolean;
    normalizeIfNeeded?: boolean;
    initialCursorPos?: 'start' | 'end' | 'lastLineStart';
    requestId?: string;
    suppressKeys?: boolean;
    selectionAnchor?: number;
    scrollIntoView?: boolean;
    preserveMainSelection?: boolean;
}

export interface PreparedOpenActiveCellTransaction {
    selection?: { anchor: number };
    effects: StateEffect<unknown>[];
}

export const requestOpenActiveCellEffect = StateEffect.define<OpenActiveCellRequestSignal>();

export function prepareOpenActiveCellTransaction(
    _view: EditorView,
    params: SelectAndRequestOpenActiveCellParams
): PreparedOpenActiveCellTransaction {
    const requestId = params.requestId ?? createOpenCellRequestId();
    const normalizeIfNeeded = params.normalizeIfNeeded ?? true;
    const request: OpenCellRequest = {
        requestId,
        activeCell: params.activeCell,
        normalizeIfNeeded,
        initialCursorPos: params.initialCursorPos,
        suppressKeys: params.suppressKeys ?? false,
    };

    return {
        ...(!params.preserveMainSelection && params.selectionAnchor != null
            ? { selection: { anchor: params.selectionAnchor } }
            : {}),
        effects: [
            ...(params.clearCellSelection ? [clearCellSelectionEffect.of(undefined)] : []),
            setActiveCellEffect.of(params.activeCell),
            beginOpenCellRequestEffect.of(request),
            requestOpenActiveCellEffect.of({
                requestId,
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
