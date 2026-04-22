import { ViewPlugin, EditorView, ViewUpdate } from '@codemirror/view';
import {
    clearActiveCellEffect,
    getActiveCell,
    isSameActiveCell,
    setActiveCellEffect,
} from '../../tableState/activeCellState';
import { activateInsertedTableEffect } from '../../tableState/insertedTableActivation';
import { isEffectiveRawMode } from '../../tableState/sourceMode';
import { rebuildAllTableWidgetsEffect, rebuildTableWidgetsEffect } from '../../tableState/tableWidgetEffects';
import { resolveActiveCell } from '../activeCell/activeCellResolver';
import { getResolvedActiveCell } from '../activeCell/resolvedActiveCellField';
import {
    closeNestedEditor,
    handleMainEditorUpdate,
    isNestedEditorOpen,
    openNestedEditor,
} from '../../nestedEditor/nestedEditorController';
import {
    clearPendingCellOpen,
    consumePendingCellOpenOptions,
    rememberPendingCellOpen,
} from '../../nestedEditor/pendingCellOpen';
import { findCellElement } from '../../tableWidget/domHelpers';
import { makeTableId } from '../../tableModel/types';
import { findTableRanges } from '../tablePositioning';
import { createActiveCellForTableText } from '../activeCell/activeCellFactory';
import { activateCellAtPosition, activateTableCell } from '../activeCell/cellActivation';
import { releasePendingNavigationCallback } from '../navigationLock';
import { requestOpenActiveCellEffect } from '../activeCell/activeCellOpen';
import { getCanonicalTableTextIfChanged, normalizeBeforeEditAnnotation } from './tableNormalization';
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

function getResolvedActiveCellFromStateOrExplicit(
    state: EditorView['state'],
    activeCell: NonNullable<ReturnType<typeof getActiveCell>>
) {
    const resolvedFromState = getResolvedActiveCell(state);
    if (resolvedFromState && isSameActiveCell(resolvedFromState.activeCell, activeCell)) {
        return resolvedFromState;
    }

    return resolveActiveCell(state, activeCell);
}

function normalizeTableBeforeOpen(params: {
    view: EditorView;
    activeCell: NonNullable<ReturnType<typeof getActiveCell>>;
    normalizeIfNeeded: boolean;
    initialCursorPos?: 'start' | 'end' | 'lastLineStart';
}): boolean {
    if (!params.normalizeIfNeeded) {
        return false;
    }

    const resolved = getResolvedActiveCellFromStateOrExplicit(params.view.state, params.activeCell);
    if (!resolved) {
        return false;
    }

    const canonicalText = getCanonicalTableTextIfChanged(resolved.ctx);
    if (!canonicalText) {
        return false;
    }

    const nextActiveCell = createActiveCellForTableText({
        tableFrom: resolved.tableFrom,
        tableText: canonicalText,
        target: params.activeCell,
    });
    if (!nextActiveCell) {
        return true;
    }

    if (params.initialCursorPos) {
        rememberPendingCellOpen(params.view, nextActiveCell.activeCell, {
            initialCursorPos: params.initialCursorPos,
        });
    }

    params.view.dispatch({
        changes: {
            from: resolved.tableFrom,
            to: resolved.tableTo,
            insert: canonicalText,
        },
        selection: { anchor: nextActiveCell.selectionAnchor },
        effects: [
            setActiveCellEffect.of(nextActiveCell.activeCell),
            requestOpenActiveCellEffect.of({
                activeCell: nextActiveCell.activeCell,
                normalizeIfNeeded: false,
            }),
            rebuildTableWidgetsEffect.of({ tableFrom: resolved.tableFrom }),
        ],
        annotations: normalizeBeforeEditAnnotation.of(true),
        scrollIntoView: false,
    });

    return true;
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
            const abortPendingOpen = (): void => {
                clearPendingCellOpen(this.view);
                releasePendingNavigationCallback();
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
                        requestViewAnimationFrame(this.view, () => {
                            if (!this.view.dom.isConnected) return;
                            if (!action.clearIfOutside && isEffectiveRawMode(this.view.state)) return;
                            activateCellAtPosition(this.view, cursorPos, {
                                clearIfOutside: action.clearIfOutside,
                                normalizeIfNeeded: action.normalizeIfNeeded,
                                preserveMainSelection: action.preserveMainSelection,
                                preferredActiveCell: getActiveCell(update.startState),
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
                    case 'openNestedEditor':
                        requestViewAnimationFrame(this.view, () => {
                            if (!this.view.dom.isConnected) {
                                abortPendingOpen();
                                return;
                            }
                            if (!isSameActiveCell(getActiveCell(this.view.state), action.activeCell)) {
                                abortPendingOpen();
                                return;
                            }
                            const resolvedActiveCell = getResolvedActiveCellFromStateOrExplicit(
                                this.view.state,
                                action.activeCell
                            );
                            if (!resolvedActiveCell) {
                                abortPendingOpen();
                                this.view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
                                return;
                            }
                            const cellElement = findCellElement(
                                this.view,
                                makeTableId(action.activeCell.tableFrom),
                                action.activeCell
                            );
                            if (!cellElement) {
                                abortPendingOpen();
                                this.view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
                                return;
                            }

                            const pendingOptions = consumePendingCellOpenOptions(this.view, action.activeCell);

                            if (
                                normalizeTableBeforeOpen({
                                    view: this.view,
                                    activeCell: resolvedActiveCell.activeCell,
                                    normalizeIfNeeded: action.normalizeIfNeeded,
                                    initialCursorPos: pendingOptions?.initialCursorPos,
                                })
                            ) {
                                return;
                            }

                            openNestedEditor({
                                mainView: this.view,
                                cellElement,
                                activeCell: resolvedActiveCell.activeCell,
                                featureSettings: getNestedEditorFeatureSettings(),
                                initialCursorPos: pendingOptions?.initialCursorPos,
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
                        clearPendingCellOpen(this.view);
                        requestViewAnimationFrame(this.view, () => {
                            if (!this.view.dom.isConnected) return;
                            this.view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
                        });
                        break;
                }
            }
        }

        destroy(): void {
            clearPendingCellOpen(this.view);
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
