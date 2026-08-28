import { ViewPlugin, EditorView, ViewUpdate } from '@codemirror/view';
import {
    clearActiveCellEffect,
    getActiveCell,
    isSameActiveCell,
    mapActiveCellThroughChanges,
} from '../../tableState/activeCellState';
import {
    clearInsertedTableActivationEffect,
    getPendingInsertedTableActivation,
} from '../../tableState/insertedTableActivation';
import { isEffectiveRawMode } from '../../tableState/sourceMode';
import { rebuildAllTableWidgetsEffect } from '../../tableState/tableWidgetEffects';
import { getResolvedActiveCell, type ResolvedActiveCell } from '../activeCell/resolvedActiveCell';
import {
    closeNestedEditor,
    handleMainEditorUpdate,
    isNestedEditorOpen,
    openNestedEditor,
} from '../../nestedEditor/nestedEditorController';
import { findCellElement } from '../../tableWidget/domHelpers';
import { makeTableId } from '../../tableModel/types';
import { activateCellAtPosition, activateTableCell } from '../activeCell/cellActivation';
import { clearOpenCellRequestEffect, getOpenCellRequestById } from '../openCellRequest';
import { hostEditorConfigFacet } from '../../services/hostEditorConfig';
import { reduceTableRuntime, type ActivateCellAtCursorOptions, type TableRuntimeAction } from './lifecyclePolicy';
import { classifyTableRuntimeFacts } from './runtimeEventClassifier';
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

interface OpenRequestExecutionGuardResult {
    request: NonNullable<ReturnType<typeof getOpenCellRequestById>>;
    resolvedActiveCell: ResolvedActiveCell;
    cellElement: HTMLElement;
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
            const facts = classifyTableRuntimeFacts(update, {
                nestedEditorOpen: isNestedEditorOpen(this.view),
                pendingFullReplaceRebuild: this.pendingFullReplaceRebuild,
            });
            const actions = reduceTableRuntime(facts);

            this.executeActions(actions, update);
        }

        private scheduleInsertedTableActivation(): void {
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
                        this.scheduleActivateCellAtCursor(update, action.options);
                        break;
                    case 'scheduleInsertedTableActivation':
                        this.scheduleInsertedTableActivation();
                        break;
                    case 'scheduleEnsureCursorVisible':
                        this.scheduleEnsureCursorVisible(action.mode);
                        break;
                    case 'closeNestedEditor':
                        if (action.reason === 'cellReposition') {
                            closeNestedEditor(this.view, snapshotResolvedCellRange(update.state) ?? undefined);
                        } else {
                            closeNestedEditor(this.view);
                        }
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

        private scheduleActivateCellAtCursor(update: ViewUpdate, activateOptions: ActivateCellAtCursorOptions): void {
            const cursorPos = update.state.selection.main.head;
            const preferredActiveCell = mapActiveCellThroughChanges(getActiveCell(update.startState), update.changes);

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
