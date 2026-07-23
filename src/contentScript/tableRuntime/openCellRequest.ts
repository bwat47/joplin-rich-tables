import { EditorState, StateEffect, StateField, type ChangeDesc } from '@codemirror/state';
import { keymap, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { logger } from '../../logger';
import { mapActiveCellThroughChanges, setActiveCellEffect, type ActiveCell } from '../tableState/activeCellState';
import { clearCellSelectionEffect } from '../tableState/cellSelectionState';
import type { ResolvedActiveCell } from './activeCell/resolvedActiveCell';

// Explicit open requests are single-flight, may survive normalization/rebuilds,
// and temporarily suppress navigation until settled.
const OPEN_CELL_REQUEST_TIMEOUT_MS = 1000;

export interface OpenCellRequest {
    requestId: string;
    activeCell: ActiveCell;
    normalizeIfNeeded: boolean;
    initialCursorPos?: 'start' | 'end' | 'lastLineStart';
    suppressKeys: boolean;
}

export interface ClearOpenCellRequest {
    requestId: string;
}

export interface OpenCellRequestSignal {
    requestId: string;
}

type OpenCellRequestTarget =
    | {
          activeCell: ActiveCell;
          selectionAnchor?: number;
      }
    | {
          resolvedCell: ResolvedActiveCell;
      };

export interface RequestOpenCellParams {
    target: OpenCellRequestTarget;
    clearCellSelection?: boolean;
    normalizeIfNeeded?: boolean;
    initialCursorPos?: 'start' | 'end' | 'lastLineStart';
    requestId?: string;
    suppressKeys?: boolean;
    scrollIntoView?: boolean;
    preserveMainSelection?: boolean;
}

export interface PreparedOpenCellRequestTransaction {
    selection?: { anchor: number };
    effects: StateEffect<unknown>[];
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

export function prepareOpenCellRequestTransaction(params: RequestOpenCellParams): PreparedOpenCellRequestTransaction {
    const requestId = params.requestId ?? createOpenCellRequestId();
    const normalizeIfNeeded = params.normalizeIfNeeded ?? true;
    const { activeCell, selectionAnchor } = resolveOpenCellRequestTarget(params.target);
    const request: OpenCellRequest = {
        requestId,
        activeCell,
        normalizeIfNeeded,
        initialCursorPos: params.initialCursorPos,
        suppressKeys: params.suppressKeys ?? false,
    };

    return {
        ...(!params.preserveMainSelection && selectionAnchor != null ? { selection: { anchor: selectionAnchor } } : {}),
        effects: [
            ...(params.clearCellSelection ? [clearCellSelectionEffect.of(undefined)] : []),
            setActiveCellEffect.of(activeCell),
            beginOpenCellRequestEffect.of(request),
            triggerOpenCellRequestEffect.of({
                requestId,
            }),
        ],
    };
}

export function requestOpenCell(view: EditorView, params: RequestOpenCellParams): void {
    view.dispatch({
        ...prepareOpenCellRequestTransaction(params),
        scrollIntoView: params.scrollIntoView ?? false,
    });
}

export const openCellRequestField = StateField.define<OpenCellRequest | null>({
    create() {
        return null;
    },

    update(value, tr) {
        let nextValue = value;
        let sawBegin = false;

        for (const effect of tr.effects) {
            if (effect.is(beginOpenCellRequestEffect)) {
                nextValue = effect.value;
                sawBegin = true;
                continue;
            }

            if (nextValue && effect.is(clearOpenCellRequestEffect) && effect.value.requestId === nextValue.requestId) {
                nextValue = null;
            }
        }

        if (tr.docChanged && nextValue && !sawBegin) {
            const activeCell = mapActiveCell(nextValue.activeCell, tr.changes);
            return activeCell ? { ...nextValue, activeCell } : null;
        }

        return nextValue;
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
