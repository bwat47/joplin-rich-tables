import { type EditorState, StateEffect, StateField, type ChangeDesc } from '@codemirror/state';
import type { ActiveCell } from './activeCellState';
import { mapTableStartUnlessDeleted } from './tableStartMapping';
import type { InitialCursorPos } from '../shared/cursorPlacement';

/**
 * An explicit request to open a cell's nested editor. Requests are single-flight, may survive
 * normalization/structural edits, and temporarily suppress navigation until settled.
 */
export interface OpenCellRequest {
    requestId: string;
    activeCell: ActiveCell;
    initialCursorPos?: InitialCursorPos;
    suppressKeys: boolean;
}

type OpenCellRequestIdentity = Pick<OpenCellRequest, 'requestId'>;

/**
 * Maps a pending request's anchor through a change set, dropping the request when the
 * anchor can no longer identify the table it was made against.
 *
 * Deletion-aware table-start mapping prevents a request whose table was removed from
 * surviving at the deletion point and reopening against whatever text replaced it.
 */
function mapActiveCell(activeCell: ActiveCell, changes: ChangeDesc): ActiveCell | undefined {
    const tableFrom = mapTableStartUnlessDeleted(activeCell.tableFrom, changes);

    // `undefined` (not null) is what StateEffect.map needs in order to drop the effect.
    return tableFrom === null ? undefined : { ...activeCell, tableFrom };
}

export const beginOpenCellRequestEffect = StateEffect.define<OpenCellRequest>({
    map(value, changes) {
        const activeCell = mapActiveCell(value.activeCell, changes);
        return activeCell ? { ...value, activeCell } : undefined;
    },
});

export const clearOpenCellRequestEffect = StateEffect.define<OpenCellRequestIdentity>();
export const triggerOpenCellRequestEffect = StateEffect.define<OpenCellRequestIdentity>();

/** A clear only applies to the request it names, so a stale clear cannot cancel a newer request. */
function clearsRequest(effect: StateEffect<unknown>, request: OpenCellRequest | null): boolean {
    return request !== null && effect.is(clearOpenCellRequestEffect) && effect.value.requestId === request.requestId;
}

/**
 * Folds a transaction's effects into the pending request. `replaced` reports whether a begin
 * effect supplied the value, which the caller needs in order to decide about remapping.
 */
function applyOpenCellRequestEffects(
    value: OpenCellRequest | null,
    effects: readonly StateEffect<unknown>[]
): { value: OpenCellRequest | null; replaced: boolean } {
    let nextValue = value;
    let replaced = false;

    for (const effect of effects) {
        if (effect.is(beginOpenCellRequestEffect)) {
            nextValue = effect.value;
            replaced = true;
        } else if (clearsRequest(effect, nextValue)) {
            nextValue = null;
        }
    }

    return { value: nextValue, replaced };
}

/** Carries a request across a document change, dropping it when its anchor is no longer salvageable. */
function remapOpenCellRequest(request: OpenCellRequest, changes: ChangeDesc): OpenCellRequest | null {
    const activeCell = mapActiveCell(request.activeCell, changes);
    return activeCell ? { ...request, activeCell } : null;
}

export const openCellRequestField = StateField.define<OpenCellRequest | null>({
    create() {
        return null;
    },

    update(value, tr) {
        const { value: nextValue, replaced } = applyOpenCellRequestEffects(value, tr.effects);

        // A begin effect dispatched alongside its own document change already carries
        // post-change coordinates, so remapping it would shift the anchor a second time.
        if (!nextValue || replaced || !tr.docChanged) {
            return nextValue;
        }

        return remapOpenCellRequest(nextValue, tr.changes);
    },
});

export function getPendingOpenCellRequest(state: EditorState): OpenCellRequest | null {
    return state.field(openCellRequestField, false) ?? null;
}

export function getOpenCellRequestById(state: EditorState, requestId: string): OpenCellRequest | null {
    const request = getPendingOpenCellRequest(state);
    if (!request || request.requestId !== requestId) {
        return null;
    }

    return request;
}

export function shouldSuppressNavigationKeys(state: EditorState): boolean {
    return getPendingOpenCellRequest(state)?.suppressKeys ?? false;
}
