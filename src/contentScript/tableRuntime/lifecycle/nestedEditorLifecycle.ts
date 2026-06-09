import { ViewPlugin, EditorView, ViewUpdate } from '@codemirror/view';
import {
    clearActiveCellEffect,
    getActiveCell,
    isSameActiveCell,
    setActiveCellEffect,
    type ActiveCell,
} from '../../tableState/activeCellState';
import {
    activateInsertedTableEffect,
    clearInsertedTableActivationEffect,
    getPendingInsertedTableActivation,
} from '../../tableState/insertedTableActivation';
import { isEffectiveRawMode } from '../../tableState/sourceMode';
import { rebuildAllTableWidgetsEffect, rebuildTableWidgetsEffect } from '../../tableState/tableWidgetEffects';
import { getResolvedActiveCell, type ResolvedActiveCell } from '../activeCell/resolvedActiveCell';
import {
    closeNestedEditor,
    handleMainEditorUpdate,
    isNestedEditorOpen,
    openNestedEditor,
} from '../../nestedEditor/nestedEditorController';
import { findCellElement } from '../../tableWidget/domHelpers';
import { makeTableId } from '../../tableModel/types';
import { createActiveCellForTableText } from '../activeCell/activeCellFactory';
import { activateCellAtPosition, activateTableCell } from '../activeCell/cellActivation';
import {
    beginOpenCellRequestEffect,
    clearOpenCellRequestEffect,
    getOpenCellRequestById,
    triggerOpenCellRequestEffect,
} from '../openCellRequest';
import { getNormalizedTableReplacementIfChanged, normalizeBeforeEditAnnotation } from './tableNormalization';
import { hostEditorConfigFacet } from '../../services/hostEditorConfig';
import { reduceTableRuntime, type ActivateCellAtCursorReason, type TableRuntimeAction } from './lifecyclePolicy';
import { classifyTableRuntimeEvent, createTableRuntimeSnapshot } from './runtimeEventClassifier';
import { requestViewAnimationFrame } from '../../shared/domContext';

// ============================================================================
// Utilities
// ============================================================================

function ensureCursorVisible(view: EditorView): void {
    const cursorPos = view.state.selection.main.head;
    const coords = view.coordsAtPos(cursorPos);
    if (!coords) return;

    const viewport = view.scrollDOM.getBoundingClientRect();
    const cursorAbove = coords.top < viewport.top;
    const cursorBelow = coords.bottom > viewport.bottom;
    if (!cursorAbove && !cursorBelow) return;

    view.dispatch({ effects: EditorView.scrollIntoView(cursorPos, { y: 'nearest' }) });
}

function hasInsertedTableActivationEffect(update: ViewUpdate): boolean {
    for (const tr of update.transactions) {
        for (const effect of tr.effects) {
            if (effect.is(activateInsertedTableEffect)) {
                return true;
            }
        }
    }

    return false;
}

function mapActiveCellThroughUpdate(update: ViewUpdate, activeCell: ActiveCell | null): ActiveCell | null {
    if (!activeCell) {
        return null;
    }

    const mappedTableFrom = update.changes.mapPos(activeCell.tableFrom, 1);
    if (!Number.isFinite(mappedTableFrom) || mappedTableFrom < 0) {
        return null;
    }

    return {
        ...activeCell,
        tableFrom: mappedTableFrom,
    };
}

type NormalizeBeforeOpenResult = 'not-needed' | 'normalized' | 'aborted';

interface OpenRequestExecutionGuardResult {
    request: NonNullable<ReturnType<typeof getOpenCellRequestById>>;
    resolvedActiveCell: ResolvedActiveCell;
    cellElement: HTMLElement;
}

interface ActivateCellAtCursorOptions {
    clearIfOutside: boolean;
    ensureCursorVisibleIfNotActivated: boolean;
    normalizeIfNeeded: boolean;
    preserveMainSelection: boolean;
}

function getActivateCellAtCursorOptions(reason: ActivateCellAtCursorReason): ActivateCellAtCursorOptions {
    if (reason === 'rawModeExit') {
        return {
            clearIfOutside: false,
            ensureCursorVisibleIfNotActivated: true,
            normalizeIfNeeded: false,
            preserveMainSelection: true,
        };
    }

    return {
        clearIfOutside: true,
        ensureCursorVisibleIfNotActivated: false,
        normalizeIfNeeded: false,
        preserveMainSelection: false,
    };
}

function normalizeTableBeforeOpen(params: {
    view: EditorView;
    resolvedActiveCell: ResolvedActiveCell;
    normalizeIfNeeded: boolean;
    requestId: string;
}): NormalizeBeforeOpenResult {
    if (!params.normalizeIfNeeded) {
        return 'not-needed';
    }

    const replacement = getNormalizedTableReplacementIfChanged(params.view.state, params.resolvedActiveCell.ctx);
    if (!replacement) {
        return 'not-needed';
    }

    const nextActiveCell = createActiveCellForTableText({
        tableFrom: replacement.tableFrom,
        tableText: replacement.tableText,
        target: params.resolvedActiveCell.activeCell,
    });
    if (!nextActiveCell) {
        return 'aborted';
    }

    const currentRequest = getOpenCellRequestById(params.view.state, params.requestId);
    if (!currentRequest) {
        return 'aborted';
    }

    params.view.dispatch({
        changes: {
            from: params.resolvedActiveCell.tableFrom,
            to: params.resolvedActiveCell.tableTo,
            insert: replacement.insert,
        },
        selection: { anchor: nextActiveCell.selectionAnchor },
        effects: [
            setActiveCellEffect.of(nextActiveCell.activeCell),
            beginOpenCellRequestEffect.of({
                ...currentRequest,
                activeCell: nextActiveCell.activeCell,
                normalizeIfNeeded: false,
            }),
            triggerOpenCellRequestEffect.of({ requestId: currentRequest.requestId }),
            rebuildTableWidgetsEffect.of({ tableFrom: replacement.tableFrom }),
        ],
        annotations: normalizeBeforeEditAnnotation.of(true),
        scrollIntoView: false,
    });

    return 'normalized';
}

// ============================================================================
// Plugin Definition
// ============================================================================

export const nestedEditorLifecyclePlugin = ViewPlugin.fromClass(
    class {
        private pendingFullReplaceRebuild: boolean;

        constructor(private view: EditorView) {
            this.pendingFullReplaceRebuild = false;
        }

        update(update: ViewUpdate): void {
            const externalRuntimeFacts = {
                nestedEditorOpen: isNestedEditorOpen(this.view),
                pendingFullReplaceRebuild: this.pendingFullReplaceRebuild,
            };
            const snapshot = createTableRuntimeSnapshot(update, externalRuntimeFacts);
            const event = classifyTableRuntimeEvent(update, snapshot);
            const actions = reduceTableRuntime(snapshot, event);

            this.executeActions(actions, update);
            this.scheduleInsertedTableActivation(update);
        }

        private scheduleInsertedTableActivation(update: ViewUpdate): void {
            if (!hasInsertedTableActivationEffect(update)) {
                return;
            }

            requestViewAnimationFrame(this.view, () => {
                if (!this.view.dom.isConnected) return;

                const activationRequest = getPendingInsertedTableActivation(this.view.state);
                if (!activationRequest) return;

                activateTableCell(this.view, activationRequest.tableFrom, activationRequest.target);
                this.view.dispatch({ effects: clearInsertedTableActivationEffect.of(undefined) });
            });
        }

        private executeActions(actions: readonly TableRuntimeAction[], update: ViewUpdate): void {
            for (const action of actions) {
                switch (action.type) {
                    case 'scheduleRebuildAllAfterFullReplace':
                        this.scheduleRebuildAllAfterFullReplace();
                        break;
                    case 'scheduleActivateCellAtCursor':
                        this.scheduleActivateCellAtCursor(update, action.reason);
                        break;
                    case 'scheduleEnsureCursorVisible':
                        this.scheduleEnsureCursorVisible(action.mode);
                        break;
                    case 'closeNestedEditor':
                        closeNestedEditor(this.view);
                        break;
                    case 'closeNestedEditorUsingResolvedUpdateRange':
                        closeNestedEditor(this.view, snapshotResolvedCellRange(update.state) ?? undefined);
                        break;
                    case 'openRequestedCell':
                        this.scheduleOpenRequestedCell(action.requestId);
                        break;
                    case 'syncMainToNested':
                        handleMainEditorUpdate(this.view, update);
                        break;
                    case 'clearActiveCell':
                        requestViewAnimationFrame(this.view, () => {
                            if (!this.view.dom.isConnected) return;
                            this.view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
                        });
                        break;
                }
            }
        }

        private scheduleRebuildAllAfterFullReplace(): void {
            this.pendingFullReplaceRebuild = true;
            requestViewAnimationFrame(this.view, () => {
                this.pendingFullReplaceRebuild = false;
                if (!this.view.dom.isConnected) return;
                this.view.dispatch({ effects: rebuildAllTableWidgetsEffect.of(undefined) });
            });
        }

        private scheduleActivateCellAtCursor(update: ViewUpdate, reason: ActivateCellAtCursorReason): void {
            const cursorPos = update.state.selection.main.head;
            const preferredActiveCell = mapActiveCellThroughUpdate(update, getActiveCell(update.startState));
            const activateOptions = getActivateCellAtCursorOptions(reason);

            requestViewAnimationFrame(this.view, () => {
                if (!this.view.dom.isConnected) return;
                if (!activateOptions.clearIfOutside && isEffectiveRawMode(this.view.state)) return;
                activateCellAtPosition(this.view, cursorPos, {
                    clearIfOutside: activateOptions.clearIfOutside,
                    normalizeIfNeeded: activateOptions.normalizeIfNeeded,
                    preserveMainSelection: activateOptions.preserveMainSelection,
                    preferredActiveCell,
                });
                if (activateOptions.ensureCursorVisibleIfNotActivated && !getActiveCell(this.view.state)) {
                    ensureCursorVisible(this.view);
                }
            });
        }

        private scheduleEnsureCursorVisible(mode: 'enteredRawMode' | 'exitedRawModeWithoutActiveCell'): void {
            requestViewAnimationFrame(this.view, () => {
                if (!this.view.dom.isConnected) return;
                if (mode === 'enteredRawMode' && !isEffectiveRawMode(this.view.state)) return;
                if (mode === 'exitedRawModeWithoutActiveCell' && isEffectiveRawMode(this.view.state)) {
                    return;
                }
                ensureCursorVisible(this.view);
            });
        }

        private scheduleOpenRequestedCell(requestId: string): void {
            requestViewAnimationFrame(this.view, () => {
                const guardResult = this.validateOpenRequestForExecution(requestId);
                if (!guardResult) {
                    return;
                }

                const normalizeResult = normalizeTableBeforeOpen({
                    view: this.view,
                    resolvedActiveCell: guardResult.resolvedActiveCell,
                    normalizeIfNeeded: guardResult.request.normalizeIfNeeded,
                    requestId,
                });
                if (normalizeResult === 'normalized') {
                    return;
                }
                if (normalizeResult === 'aborted') {
                    this.failOpenRequest(requestId);
                    return;
                }

                const opened = openNestedEditor({
                    mainView: this.view,
                    cellElement: guardResult.cellElement,
                    featureSettings: this.view.state.facet(hostEditorConfigFacet).nestedEditor,
                    initialCursorPos: guardResult.request.initialCursorPos,
                });
                if (!opened) {
                    this.failOpenRequest(requestId);
                    return;
                }
                requestViewAnimationFrame(this.view, () => {
                    this.view.dispatch({
                        effects: clearOpenCellRequestEffect.of({ requestId }),
                    });
                });
            });
        }

        private validateOpenRequestForExecution(requestId: string): OpenRequestExecutionGuardResult | null {
            const request = getOpenCellRequestById(this.view.state, requestId);
            if (!request) {
                return null;
            }

            const targetActiveCell = request.activeCell;
            if (!this.view.dom.isConnected) {
                this.failOpenRequest(requestId);
                return null;
            }

            if (!isSameActiveCell(getActiveCell(this.view.state), targetActiveCell)) {
                this.failOpenRequest(requestId);
                return null;
            }

            const resolvedActiveCell = getResolvedActiveCell(this.view.state);
            if (!resolvedActiveCell) {
                this.failOpenRequest(requestId);
                this.view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
                return null;
            }

            const cellElement = findCellElement(this.view, makeTableId(targetActiveCell.tableFrom), targetActiveCell);
            if (!cellElement) {
                this.failOpenRequest(requestId);
                this.view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
                return null;
            }

            return {
                request,
                resolvedActiveCell,
                cellElement,
            };
        }

        private failOpenRequest(requestId: string): void {
            this.view.dispatch({ effects: clearOpenCellRequestEffect.of({ requestId }) });
        }

        destroy(): void {
            closeNestedEditor(this.view);
        }
    }
);

function snapshotResolvedCellRange(state: EditorView['state']): { contentFrom: number; contentTo: number } | null {
    const resolved = getResolvedActiveCell(state);
    if (!resolved) {
        return null;
    }

    return {
        contentFrom: resolved.contentFrom,
        contentTo: resolved.contentTo,
    };
}
