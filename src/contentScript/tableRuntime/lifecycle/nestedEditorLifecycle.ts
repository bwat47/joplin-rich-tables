import { ViewPlugin, EditorView, ViewUpdate } from '@codemirror/view';
import {
    clearActiveCellEffect,
    getActiveCell,
    isSameActiveCell,
    setActiveCellEffect,
    type ActiveCell,
} from '../../tableState/activeCellState';
import { cellSelectionTransitionAnnotation } from '../../tableState/cellSelectionState';
import { activateInsertedTableEffect } from '../../tableState/insertedTableActivation';
import { syncAnnotation } from '../../editorBridge/syncAnnotation';
import {
    exitSearchForceSourceModeEffect,
    setSearchForceSourceModeEffect,
} from '../../tableState/searchForceSourceMode';
import { exitSourceModeEffect, isEffectiveRawMode, toggleSourceModeEffect } from '../../tableState/sourceMode';
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
    clearOpenCellRequestEffect,
    getOpenCellRequestById,
    triggerOpenCellRequestEffect,
} from '../openCellRequest';
import { getNormalizedTableReplacementIfChanged, normalizeBeforeEditAnnotation } from './tableNormalization';
import { hostEditorConfigFacet } from '../../services/hostEditorConfig';
import { planTableLifecycleActions, type TableRuntimeAction } from './lifecyclePolicy';
import { requestViewAnimationFrame } from '../../shared/domContext';
import { isFullDocumentReplace } from '../../shared/transactionUtils';
import { transactionRequiresTableRebuild } from '../tableTransactionHelpers';
import type { TableLifecyclePolicyEvent, TableLifecyclePolicyState } from './lifecyclePolicy';

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

function scanRawModeTransitionFacts(update: ViewUpdate, previousEffectiveRawMode: boolean) {
    let exitedSourceMode = false;
    let exitedSearchForce = false;
    let hadRawModeToggle = false;

    for (const tr of update.transactions) {
        for (const effect of tr.effects) {
            if (effect.is(exitSourceModeEffect)) {
                exitedSourceMode = true;
                hadRawModeToggle = true;
            }
            if (effect.is(exitSearchForceSourceModeEffect)) {
                exitedSearchForce = true;
                hadRawModeToggle = true;
            }
            if (effect.is(toggleSourceModeEffect) || effect.is(setSearchForceSourceModeEffect)) {
                hadRawModeToggle = true;
            }
        }
    }

    const effectiveRawMode = isEffectiveRawMode(update.state);

    return {
        enteredRawMode: hadRawModeToggle && !previousEffectiveRawMode && effectiveRawMode,
        exitedRawMode: hadRawModeToggle && previousEffectiveRawMode && !effectiveRawMode,
        exitedSourceMode,
        exitedSearchForce,
    };
}

function extractOpenRequestId(update: ViewUpdate): string | null {
    let requestId: string | null = null;

    for (const tr of update.transactions) {
        for (const effect of tr.effects) {
            if (effect.is(triggerOpenCellRequestEffect)) {
                requestId = effect.value.requestId;
            }
        }
    }

    return requestId;
}

function isPositionInsideRange(pos: number, from: number, to: number): boolean {
    return pos >= from && pos <= to;
}

function isSelectionOutsideResolvedTable(update: ViewUpdate, resolvedActiveCell: ResolvedActiveCell | null): boolean {
    if (!resolvedActiveCell) {
        return false;
    }

    const { main } = update.state.selection;
    return (
        !isPositionInsideRange(main.anchor, resolvedActiveCell.tableFrom, resolvedActiveCell.tableTo) ||
        !isPositionInsideRange(main.head, resolvedActiveCell.tableFrom, resolvedActiveCell.tableTo)
    );
}

function cursorInsideAnyTable(update: ViewUpdate): boolean {
    const cursorPos = update.state.selection.main.head;
    return findTableRanges(update.state).some((table) => cursorPos >= table.from && cursorPos <= table.to);
}

function updateRequiresCellReposition(params: {
    update: ViewUpdate;
    effectiveRawMode: boolean;
    hadActiveCell: boolean;
    resolvedPrevActiveCell: ResolvedActiveCell | null;
    isSync: boolean;
}): boolean {
    if (!params.update.docChanged || params.isSync || params.effectiveRawMode) {
        return false;
    }

    if (params.hadActiveCell && params.resolvedPrevActiveCell) {
        return params.update.transactions.some((tr) =>
            transactionRequiresTableRebuild(tr, params.resolvedPrevActiveCell)
        );
    }

    const isUndoRedo = params.update.transactions.some((tr) => tr.isUserEvent('undo') || tr.isUserEvent('redo'));
    return isUndoRedo && cursorInsideAnyTable(params.update);
}

function collectLifecyclePlannerInput(params: {
    update: ViewUpdate;
    nestedEditorOpen: boolean;
    hadActiveCell: boolean;
    pendingFullReplaceRebuild: boolean;
    previousEffectiveRawMode: boolean;
}): { state: TableLifecyclePolicyState; event: TableLifecyclePolicyEvent } {
    const activeCell = getActiveCell(params.update.state);
    const prevActiveCell = getActiveCell(params.update.startState);
    const resolvedActiveCell = getResolvedActiveCell(params.update.state);
    const resolvedPrevActiveCell = getResolvedActiveCell(params.update.startState);
    const effectiveRawMode = isEffectiveRawMode(params.update.state);
    const isSync = params.update.transactions.some((tr) => Boolean(tr.annotation(syncAnnotation)));
    const shouldSyncDoc = params.update.docChanged && Boolean(resolvedActiveCell) && params.nestedEditorOpen && !isSync;
    const shouldSyncSelection =
        params.update.selectionSet &&
        isSameActiveCell(prevActiveCell, activeCell) &&
        Boolean(resolvedActiveCell) &&
        params.nestedEditorOpen &&
        !isSync;

    return {
        state: {
            hasActiveCell: Boolean(activeCell),
            currentActiveCellResolved: Boolean(resolvedActiveCell),
            effectiveRawMode,
            nestedEditorOpen: params.nestedEditorOpen,
            hadActiveCell: params.hadActiveCell,
            pendingFullReplaceRebuild: params.pendingFullReplaceRebuild,
        },
        event: {
            docChanged: params.update.docChanged,
            selectionChanged: params.update.selectionSet,
            isSync,
            isNormalizeBeforeEdit: params.update.transactions.some((tr) =>
                Boolean(tr.annotation(normalizeBeforeEditAnnotation))
            ),
            isCellSelectionTransition: params.update.transactions.some((tr) =>
                Boolean(tr.annotation(cellSelectionTransitionAnnotation))
            ),
            rawModeTransition: scanRawModeTransitionFacts(params.update, params.previousEffectiveRawMode),
            hasFullDocumentReplace: params.update.transactions.some((tr) => isFullDocumentReplace(tr)),
            openRequestId: extractOpenRequestId(params.update),
            selectionLeftActiveTable: isSelectionOutsideResolvedTable(params.update, resolvedActiveCell),
            requiresCellReposition: updateRequiresCellReposition({
                update: params.update,
                effectiveRawMode,
                hadActiveCell: params.hadActiveCell,
                resolvedPrevActiveCell,
                isSync,
            }),
            shouldSyncMainToNested: shouldSyncDoc || shouldSyncSelection,
        },
    };
}

type NormalizeBeforeOpenResult = 'not-needed' | 'normalized' | 'aborted';

function getActivateCellAtCursorOptions(reason: 'rawModeExit' | 'cellReposition') {
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
        private hadActiveCell: boolean;
        private wasEffectiveRawMode: boolean;
        private pendingFullReplaceRebuild: boolean;

        constructor(private view: EditorView) {
            this.hadActiveCell = Boolean(getActiveCell(view.state));
            this.wasEffectiveRawMode = isEffectiveRawMode(view.state);
            this.pendingFullReplaceRebuild = false;
        }

        update(update: ViewUpdate): void {
            const { state, event } = collectLifecyclePlannerInput({
                update,
                nestedEditorOpen: isNestedEditorOpen(this.view),
                hadActiveCell: this.hadActiveCell,
                pendingFullReplaceRebuild: this.pendingFullReplaceRebuild,
                previousEffectiveRawMode: this.wasEffectiveRawMode,
            });
            const actions = planTableLifecycleActions(state, event);

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
                        const activateOptions = getActivateCellAtCursorOptions(action.reason);
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

        private scheduleOpenRequestedCell(requestId: string): void {
            requestViewAnimationFrame(this.view, () => {
                const request = getOpenCellRequestById(this.view.state, requestId);
                if (!request) {
                    return;
                }

                const targetActiveCell = request.activeCell;
                const normalizeIfNeeded = request.normalizeIfNeeded;
                if (!this.view.dom.isConnected) {
                    this.failOpenRequest(requestId);
                    return;
                }
                if (!isSameActiveCell(getActiveCell(this.view.state), targetActiveCell)) {
                    this.failOpenRequest(requestId);
                    return;
                }
                const resolvedActiveCell = getResolvedActiveCell(this.view.state);
                if (!resolvedActiveCell) {
                    this.failOpenRequest(requestId);
                    this.view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
                    return;
                }
                const cellElement = findCellElement(
                    this.view,
                    makeTableId(targetActiveCell.tableFrom),
                    targetActiveCell
                );
                if (!cellElement) {
                    this.failOpenRequest(requestId);
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
                    this.failOpenRequest(requestId);
                    return;
                }

                const opened = openNestedEditor({
                    mainView: this.view,
                    cellElement,
                    featureSettings: this.view.state.facet(hostEditorConfigFacet).nestedEditor,
                    initialCursorPos: request.initialCursorPos,
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
