import { EditorState, StateEffect, StateField, type ChangeDesc, type TransactionSpec } from '@codemirror/state';
import { keymap, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { logger } from '../../logger';
import { mapActiveCellThroughChanges, setActiveCellEffect, type ActiveCell } from '../tableState/activeCellState';
import { clearCellSelectionEffect } from '../tableState/cellSelectionState';
import { rebuildTableWidgetsEffect } from '../tableState/tableWidgetEffects';
import { normalizeBeforeEditAnnotation, planCellEntryNormalization } from './tableCanonicalForm';
import type { InitialCursorPos } from '../shared/cursorPlacement';
import type { ResolvedActiveCell } from './activeCell/resolvedActiveCell';

// Explicit open requests are single-flight, may survive normalization/rebuilds,
// and temporarily suppress navigation until settled.
const OPEN_CELL_REQUEST_TIMEOUT_MS = 1000;

export interface OpenCellRequest {
    requestId: string;
    activeCell: ActiveCell;
    initialCursorPos?: InitialCursorPos;
    suppressKeys: boolean;
}

export interface ClearOpenCellRequest {
    requestId: string;
}

export interface OpenCellRequestSignal {
    requestId: string;
}

/**
 * A cell resolved against the current document can be normalized on the way in. Bare
 * coordinates cannot: they belong to a table the caller is about to create in the same
 * transaction, so there is nothing in the current document to resolve them against.
 */
type OpenCellRequestTarget =
    | {
          activeCell: ActiveCell;
          selectionAnchor?: number;
      }
    | {
          resolvedCell: ResolvedActiveCell;
      };

/** A transaction spec whose effects stay an array, so callers can extend them. */
export interface PreparedOpenCellRequestTransaction extends TransactionSpec {
    effects: StateEffect<unknown>[];
}

export interface RequestOpenCellParams {
    target: OpenCellRequestTarget;
    clearCellSelection?: boolean;
    /** Fold canonical-form repair into this transaction when the table needs it (default true). */
    normalizeIfNeeded?: boolean;
    initialCursorPos?: InitialCursorPos;
    requestId?: string;
    suppressKeys?: boolean;
    scrollIntoView?: boolean;
    preserveMainSelection?: boolean;
}

export interface PrepareOpenCellRequestTransactionParams extends RequestOpenCellParams {
    state: EditorState;
}

let nextOpenCellRequestId = 1;

/**
 * Maps a pending request's anchor through a change set, dropping the request when the
 * anchor can no longer identify the table it was made against.
 *
 * The deletion scan is specific to open requests: an anchor sitting inside a deleted range
 * maps to the deletion point rather than disappearing, so a request whose table was removed
 * would otherwise survive and reopen against whatever text replaced it. Bounds-safe mapping
 * is shared with the active-cell field so both agree on which anchors are salvageable.
 */
function mapActiveCell(activeCell: ActiveCell, changes: ChangeDesc): ActiveCell | undefined {
    let tableStartDeleted = false;
    changes.iterChangedRanges((fromA, toA) => {
        if (fromA <= activeCell.tableFrom && activeCell.tableFrom < toA) {
            tableStartDeleted = true;
        }
    });
    if (tableStartDeleted) {
        return undefined;
    }

    // `undefined` (not null) is what StateEffect.map needs in order to drop the effect.
    return mapActiveCellThroughChanges(activeCell, changes) ?? undefined;
}

function createOpenCellRequestId(): string {
    const requestId = `open-cell-${nextOpenCellRequestId}`;
    nextOpenCellRequestId += 1;
    return requestId;
}

export const beginOpenCellRequestEffect = StateEffect.define<OpenCellRequest>({
    map(value, changes) {
        const activeCell = mapActiveCell(value.activeCell, changes);
        return activeCell ? { ...value, activeCell } : undefined;
    },
});

export const clearOpenCellRequestEffect = StateEffect.define<ClearOpenCellRequest>();
export const triggerOpenCellRequestEffect = StateEffect.define<OpenCellRequestSignal>();

function resolveOpenCellRequestTarget(target: OpenCellRequestTarget): {
    activeCell: ActiveCell;
    selectionAnchor?: number;
} {
    if ('resolvedCell' in target) {
        return {
            activeCell: target.resolvedCell.activeCell,
            selectionAnchor: target.resolvedCell.editableFrom,
        };
    }

    return target;
}

/** The repair this entry owes the table, or null when none is needed or wanted. */
function planNormalization(params: PrepareOpenCellRequestTransactionParams) {
    if (params.normalizeIfNeeded === false || !('resolvedCell' in params.target)) {
        return null;
    }

    const { resolvedCell } = params.target;
    return planCellEntryNormalization({
        state: params.state,
        ctx: resolvedCell.ctx,
        coords: resolvedCell.activeCell,
    });
}

/**
 * Builds the whole entry as one transaction: the canonical-form repair the table needs,
 * the active cell it lands on, and the request that opens it.
 *
 * Keeping the repair here rather than in a follow-up dispatch means the document change
 * always belongs to the event that asked for the entry. A repair arriving a frame later
 * reaches the host as an update it cannot order against the keystrokes around it, and the
 * host writes a stale note body back over the editor.
 */
export function prepareOpenCellRequestTransaction(
    params: PrepareOpenCellRequestTransactionParams
): PreparedOpenCellRequestTransaction {
    const requestId = params.requestId ?? createOpenCellRequestId();
    const normalization = planNormalization(params);
    const { activeCell, selectionAnchor } = normalization
        ? normalization.target
        : resolveOpenCellRequestTarget(params.target);

    const request: OpenCellRequest = {
        requestId,
        activeCell,
        initialCursorPos: params.initialCursorPos,
        suppressKeys: params.suppressKeys ?? false,
    };

    return {
        ...(normalization
            ? { changes: normalization.changes, annotations: normalizeBeforeEditAnnotation.of(true) }
            : {}),
        ...(!params.preserveMainSelection && selectionAnchor != null ? { selection: { anchor: selectionAnchor } } : {}),
        effects: [
            ...(params.clearCellSelection ? [clearCellSelectionEffect.of(undefined)] : []),
            setActiveCellEffect.of(activeCell),
            beginOpenCellRequestEffect.of(request),
            triggerOpenCellRequestEffect.of({
                requestId,
            }),
            ...(normalization ? [rebuildTableWidgetsEffect.of(undefined)] : []),
        ],
    };
}

export function requestOpenCell(view: EditorView, params: RequestOpenCellParams): void {
    view.dispatch({
        ...prepareOpenCellRequestTransaction({ ...params, state: view.state }),
        scrollIntoView: params.scrollIntoView ?? false,
    });
}

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

export const openCellRequestKeymap = keymap.of([
    {
        key: 'Tab',
        run: (view) => shouldSuppressNavigationKeys(view.state),
    },
    {
        key: 'Shift-Tab',
        run: (view) => shouldSuppressNavigationKeys(view.state),
    },
    {
        key: 'Enter',
        run: (view) => shouldSuppressNavigationKeys(view.state),
    },
]);

export const openCellRequestTimeoutPlugin = ViewPlugin.fromClass(
    class {
        private timeoutId: ReturnType<typeof setTimeout> | null = null;
        private requestId: string | null = null;

        constructor(private view: EditorView) {
            this.syncTimeout();
        }

        update(update: ViewUpdate): void {
            if (
                update.startState.field(openCellRequestField, false) !== update.state.field(openCellRequestField, false)
            ) {
                this.syncTimeout();
            }
        }

        destroy(): void {
            this.clearTimeout();
        }

        private syncTimeout(): void {
            const request = getPendingOpenCellRequest(this.view.state);
            if (!request) {
                this.clearTimeout();
                return;
            }

            if (this.requestId === request.requestId && this.timeoutId !== null) {
                return;
            }

            this.clearTimeout();
            this.requestId = request.requestId;
            this.timeoutId = setTimeout(() => {
                const currentRequest = getPendingOpenCellRequest(this.view.state);
                if (!currentRequest || currentRequest.requestId !== request.requestId) {
                    return;
                }

                logger.warn('Open-cell request timed out - forcing release');
                this.view.dispatch({
                    effects: clearOpenCellRequestEffect.of({ requestId: request.requestId }),
                });
            }, OPEN_CELL_REQUEST_TIMEOUT_MS);
        }

        private clearTimeout(): void {
            if (this.timeoutId !== null) {
                clearTimeout(this.timeoutId);
                this.timeoutId = null;
            }
            this.requestId = null;
        }
    }
);
