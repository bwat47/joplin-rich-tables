import type { EditorState, StateEffect, TransactionSpec } from '@codemirror/state';
import { keymap, type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { logger } from '../../logger';
import { setActiveCellEffect, type ActiveCell } from '../tableState/activeCellState';
import {
    beginOpenCellRequestEffect,
    clearOpenCellRequestEffect,
    getPendingOpenCellRequest,
    openCellRequestField,
    shouldSuppressNavigationKeys,
    triggerOpenCellRequestEffect,
} from '../tableState/openCellRequestState';
import { structuralTableEditEffect } from '../tableState/structuralTableEditEffect';
import { normalizeBeforeEditAnnotation, planCellEntryNormalization } from './tableCanonicalForm';
import type { InitialCursorPos } from '../tableState/cursorPlacement';
import type { ResolvedActiveCell } from '../tableState/resolvedActiveCell';

/** How long a request may stay pending before the timeout plugin forcibly releases it. */
const OPEN_CELL_REQUEST_TIMEOUT_MS = 1000;

/** A transaction spec whose effects stay an array, so callers can extend them. */
export interface PreparedOpenCellRequestTransaction extends TransactionSpec {
    effects: StateEffect<unknown>[];
}

/**
 * Selection and effects that attach an open request to a transaction the caller owns.
 *
 * Deliberately not a `TransactionSpec`: the caller merges this into its own spec, so the
 * type must not be able to carry a `changes` key that would override the caller's.
 */
export interface OpenCellRequestAttachment {
    selection: { anchor: number };
    effects: StateEffect<unknown>[];
}

interface OpenCellRequestOptions {
    initialCursorPos?: InitialCursorPos;
    suppressKeys?: boolean;
}

/**
 * How far an entry may go, from most to least.
 *
 * - `repair`: rewrite the table into canonical form if it needs it, then put the caret in the cell.
 * - `enter`: put the caret in the cell, leaving the document as it stands.
 * - `adopt`: leave the document and the caret alone; only re-establish the active cell.
 *
 * A ladder rather than separate flags: repairing the table without moving the caret would leave
 * the preserved selection mapped through a whole-table replacement, which preserves nothing.
 */
export type CellEntryMode = 'repair' | 'enter' | 'adopt';

const DEFAULT_CELL_ENTRY_MODE: CellEntryMode = 'repair';

export interface RequestOpenCellParams extends OpenCellRequestOptions {
    resolvedCell: ResolvedActiveCell;
    /** How far this entry may go (default `repair`). */
    entryMode?: CellEntryMode;
    scrollIntoView?: boolean;
}

let nextOpenCellRequestId = 1;

function createOpenCellRequestId(): string {
    const requestId = `open-cell-${nextOpenCellRequestId}`;
    nextOpenCellRequestId += 1;
    return requestId;
}

function buildOpenCellRequestEffects(
    params: OpenCellRequestOptions & { requestId: string; activeCell: ActiveCell }
): StateEffect<unknown>[] {
    return [
        setActiveCellEffect.of(params.activeCell),
        beginOpenCellRequestEffect.of({
            requestId: params.requestId,
            activeCell: params.activeCell,
            initialCursorPos: params.initialCursorPos,
            suppressKeys: params.suppressKeys ?? false,
        }),
        triggerOpenCellRequestEffect.of({ requestId: params.requestId }),
    ];
}

/**
 * Attaches an open request for bare coordinates to a transaction the caller owns.
 *
 * The coordinates belong to a table the caller is about to write, so there is nothing in
 * the current document to resolve or repair them against: this path never normalizes.
 */
export function prepareOpenCellRequestAttachment(
    params: OpenCellRequestOptions & { activeCell: ActiveCell; selectionAnchor: number }
): OpenCellRequestAttachment {
    const requestId = createOpenCellRequestId();

    return {
        selection: { anchor: params.selectionAnchor },
        effects: buildOpenCellRequestEffects({ ...params, requestId }),
    };
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
    params: RequestOpenCellParams & { state: EditorState }
): PreparedOpenCellRequestTransaction {
    const requestId = createOpenCellRequestId();
    const entryMode = params.entryMode ?? DEFAULT_CELL_ENTRY_MODE;
    const normalization =
        entryMode === 'repair'
            ? planCellEntryNormalization({
                  state: params.state,
                  ctx: params.resolvedCell.ctx,
                  coords: params.resolvedCell.activeCell,
              })
            : null;

    const activeCell = normalization?.target.activeCell ?? params.resolvedCell.activeCell;
    const selectionAnchor = normalization?.target.selectionAnchor ?? params.resolvedCell.editableFrom;

    return {
        ...(normalization
            ? { changes: normalization.changes, annotations: normalizeBeforeEditAnnotation.of(true) }
            : {}),
        ...(entryMode === 'adopt' ? {} : { selection: { anchor: selectionAnchor } }),
        effects: [
            ...buildOpenCellRequestEffects({ ...params, requestId, activeCell }),
            ...(normalization ? [structuralTableEditEffect.of(null)] : []),
        ],
    };
}

export function requestOpenCell(view: EditorView, params: RequestOpenCellParams): void {
    view.dispatch({
        ...prepareOpenCellRequestTransaction({ ...params, state: view.state }),
        scrollIntoView: params.scrollIntoView ?? false,
    });
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
