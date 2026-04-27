import { ViewPlugin, EditorView, ViewUpdate } from '@codemirror/view';
import {
    clearActiveCellEffect,
    getActiveCell,
    isSameActiveCell,
    setActiveCellEffect,
    type ActiveCell,
} from '../../tableState/activeCellState';
import { activateInsertedTableEffect } from '../../tableState/insertedTableActivation';
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
import { findTableRanges } from '../tableResolution';
import { createActiveCellForTableText } from '../activeCell/activeCellFactory';
import { activateCellAtPosition, activateTableCell } from '../activeCell/cellActivation';
import {
    beginOpenCellRequestEffect,
    completeOpenCellRequestEffect,
    failOpenCellRequestEffect,
    getOpenCellRequestById,
    requestOpenCellEffect,
} from '../openCellRequest';
import { getNormalizedTableReplacementIfChanged, normalizeBeforeEditAnnotation } from './tableNormalization';
import { getNestedEditorFeatureSettings } from '../../services/nestedEditorFeatureSettings';
import {
    buildTableRuntimeEvent,
    buildTableRuntimeSnapshot,
    planTableLifecycleActions,
    type TableRuntimeAction,
} from './lifecyclePolicy';
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

function getInsertedTableActivationRequest(update: ViewUpdate) {
    for (const tr of update.transactions) {
        for (const effect of tr.effects) {
            if (effect.is(activateInsertedTableEffect)) {
                return effect.value;
            }
        }
    }

    return null;
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
            requestOpenCellEffect.of({ requestId: currentRequest.requestId }),
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
        private hadActiveCell: boolean;
        private wasEffectiveRawMode: boolean;
        private pendingFullReplaceRebuild: boolean;

        constructor(private view: EditorView) {
            this.hadActiveCell = Boolean(getActiveCell(view.state));
            this.wasEffectiveRawMode = isEffectiveRawMode(view.state);
            this.pendingFullReplaceRebuild = false;
        }

        update(update: ViewUpdate): void {
            const snapshot = buildTableRuntimeSnapshot({
                update,
                nestedEditorOpen: isNestedEditorOpen(this.view),
                hadActiveCell: this.hadActiveCell,
                pendingFullReplaceRebuild: this.pendingFullReplaceRebuild,
            });
            const event = buildTableRuntimeEvent(update, this.wasEffectiveRawMode);
            const cursorPos = update.state.selection.main.head;
            const cursorInsideTableAfterUndoRedo = findTableRanges(update.state).some(
                (table) => cursorPos >= table.from && cursorPos <= table.to
            );
            const actions = planTableLifecycleActions(snapshot, event, { cursorInsideTableAfterUndoRedo });

            this.executeActions(actions, update);
            this.scheduleInsertedTableActivation(update);
            this.hadActiveCell = Boolean(getActiveCell(update.state));
            this.wasEffectiveRawMode = isEffectiveRawMode(update.state);
        }

        private scheduleInsertedTableActivation(update: ViewUpdate): void {
            const activationRequest = getInsertedTableActivationRequest(update);
            if (!activationRequest) {
                return;
            }

            requestViewAnimationFrame(this.view, () => {
                if (!this.view.dom.isConnected) return;

                activateTableCell(this.view, activationRequest.tableFrom, activationRequest.target);
            });
        }

        private executeActions(actions: readonly TableRuntimeAction[], update: ViewUpdate): void {
            const failOpenRequest = (requestId: string | undefined): void => {
                if (!requestId) return;
                this.view.dispatch({ effects: failOpenCellRequestEffect.of({ requestId }) });
            };

            for (const action of actions) {
                switch (action.type) {
                    case 'scheduleRebuildAllAfterFullReplace':
                        this.pendingFullReplaceRebuild = true;
                        requestViewAnimationFrame(this.view, () => {
                            this.pendingFullReplaceRebuild = false;
                            if (!this.view.dom.isConnected) return;
                            this.view.dispatch({ effects: rebuildAllTableWidgetsEffect.of(undefined) });
                        });
                        break;
                    case 'scheduleActivateCellAtCursor': {
                        const cursorPos = update.state.selection.main.head;
                        const preferredActiveCell = mapActiveCellThroughUpdate(
                            update,
                            getActiveCell(update.startState)
                        );
                        requestViewAnimationFrame(this.view, () => {
                            if (!this.view.dom.isConnected) return;
                            if (!action.clearIfOutside && isEffectiveRawMode(this.view.state)) return;
                            activateCellAtPosition(this.view, cursorPos, {
                                clearIfOutside: action.clearIfOutside,
                                normalizeIfNeeded: action.normalizeIfNeeded,
                                preserveMainSelection: action.preserveMainSelection,
                                preferredActiveCell,
                            });
                            if (action.ensureCursorVisibleIfNotActivated && !getActiveCell(this.view.state)) {
                                ensureCursorVisible(this.view);
                            }
                        });
                        break;
                    }
                    case 'scheduleEnsureCursorVisible':
                        requestViewAnimationFrame(this.view, () => {
                            if (!this.view.dom.isConnected) return;
                            if (action.mode === 'enteredRawMode' && !isEffectiveRawMode(this.view.state)) return;
                            if (
                                action.mode === 'exitedRawModeWithoutActiveCell' &&
                                isEffectiveRawMode(this.view.state)
                            ) {
                                return;
                            }
                            ensureCursorVisible(this.view);
                        });
                        break;
                    case 'closeNestedEditor':
                        if (action.useResolvedRangeFromUpdate) {
                            closeNestedEditor(this.view, snapshotResolvedCellRange(update.state) ?? undefined);
                        } else {
                            closeNestedEditor(this.view);
                        }
                        break;
                    case 'openRequestedCell':
                        requestViewAnimationFrame(this.view, () => {
                            const request = getOpenCellRequestById(this.view.state, action.requestId);
                            if (!request) {
                                return;
                            }

                            const requestId = action.requestId;
                            const targetActiveCell = request.activeCell;
                            const normalizeIfNeeded = request.normalizeIfNeeded;
                            if (!this.view.dom.isConnected) {
                                failOpenRequest(requestId);
                                return;
                            }
                            if (!isSameActiveCell(getActiveCell(this.view.state), targetActiveCell)) {
                                failOpenRequest(requestId);
                                return;
                            }
                            const resolvedActiveCell = getResolvedActiveCell(this.view.state);
                            if (!resolvedActiveCell) {
                                failOpenRequest(requestId);
                                this.view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
                                return;
                            }
                            const cellElement = findCellElement(
                                this.view,
                                makeTableId(targetActiveCell.tableFrom),
                                targetActiveCell
                            );
                            if (!cellElement) {
                                failOpenRequest(requestId);
                                this.view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
                                return;
                            }

                            const normalizeResult = normalizeTableBeforeOpen({
                                view: this.view,
                                resolvedActiveCell,
                                normalizeIfNeeded,
                                requestId,
                            });
                            if (normalizeResult === 'normalized') {
                                return;
                            }
                            if (normalizeResult === 'aborted') {
                                failOpenRequest(requestId);
                                return;
                            }

                            const opened = openNestedEditor({
                                mainView: this.view,
                                cellElement,
                                featureSettings: getNestedEditorFeatureSettings(),
                                initialCursorPos: request.initialCursorPos,
                            });
                            if (!opened) {
                                failOpenRequest(requestId);
                                return;
                            }
                            requestViewAnimationFrame(this.view, () => {
                                this.view.dispatch({
                                    effects: completeOpenCellRequestEffect.of({ requestId }),
                                });
                            });
                        });
                        break;
                    case 'syncMainDocToNested':
                        handleMainEditorUpdate(this.view, update);
                        break;
                    case 'syncMainSelectionToNested':
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
