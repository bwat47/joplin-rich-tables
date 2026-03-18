import { ViewPlugin, EditorView, ViewUpdate } from '@codemirror/view';
import { clearActiveCellEffect, getActiveCell, isSameActiveCell } from '../tableState/activeCellState';
import { activateInsertedTableEffect } from '../tableState/insertedTableActivation';
import { isEffectiveRawMode } from '../tableState/sourceMode';
import { rebuildAllTableWidgetsEffect } from '../tableState/tableWidgetEffects';
import { resolveActiveCell } from './activeCellResolver';
import {
    closeNestedCellEditor,
    handleMainEditorUpdateForNestedEditor,
    isNestedCellEditorOpen,
    openNestedCellEditor,
} from '../nestedEditor/nestedCellEditor';
import { clearPendingCellOpen, consumePendingCellOpenOptions } from '../nestedEditor/pendingCellOpen';
import { findCellElement } from '../tableWidget/domHelpers';
import { makeTableId } from '../tableModel/types';
import { findTableRanges } from './tablePositioning';
import { activateCellAtPosition, activateTableCell } from './cellActivation';
import { releasePendingNavigationCallback } from './navigationLock';
import {
    buildTableRuntimeEvent,
    buildTableRuntimeSnapshot,
    planTableLifecycleActions,
    type TableRuntimeAction,
} from './tableRuntimeTransitions';

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
                nestedEditorOpen: isNestedCellEditorOpen(this.view),
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

            requestAnimationFrame(() => {
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
                        requestAnimationFrame(() => {
                            this.pendingFullReplaceRebuild = false;
                            if (!this.view.dom.isConnected) return;
                            this.view.dispatch({ effects: rebuildAllTableWidgetsEffect.of(undefined) });
                        });
                        break;
                    case 'scheduleActivateCellAtCursor': {
                        const cursorPos = update.state.selection.main.head;
                        requestAnimationFrame(() => {
                            if (!this.view.dom.isConnected) return;
                            if (!action.clearIfOutside && isEffectiveRawMode(this.view.state)) return;
                            activateCellAtPosition(this.view, cursorPos, {
                                clearIfOutside: action.clearIfOutside,
                                normalizeIfNeeded: action.normalizeIfNeeded,
                            });
                            if (action.ensureCursorVisibleIfNotActivated && !getActiveCell(this.view.state)) {
                                ensureCursorVisible(this.view);
                            }
                        });
                        break;
                    }
                    case 'scheduleEnsureCursorVisible':
                        requestAnimationFrame(() => {
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
                        closeNestedCellEditor(
                            this.view,
                            snapshotResolvedCellRange(update.state) ?? undefined
                        );
                        break;
                    case 'openNestedEditor':
                        requestAnimationFrame(() => {
                            if (!this.view.dom.isConnected) {
                                abortPendingOpen();
                                return;
                            }
                            if (!isSameActiveCell(getActiveCell(this.view.state), action.activeCell)) {
                                abortPendingOpen();
                                return;
                            }
                            const resolvedActiveCell = resolveActiveCell(this.view.state, action.activeCell);
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

                            openNestedCellEditor({
                                mainView: this.view,
                                cellElement,
                                activeCell: resolvedActiveCell.activeCell,
                                normalizeIfNeeded: false,
                                initialCursorPos: pendingOptions?.initialCursorPos,
                            });
                        });
                        break;
                    case 'syncMainDocToNested':
                        handleMainEditorUpdateForNestedEditor(this.view, update);
                        break;
                    case 'syncMainSelectionToNested':
                        handleMainEditorUpdateForNestedEditor(this.view, update);
                        break;
                    case 'clearActiveCell':
                        clearPendingCellOpen(this.view);
                        this.view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
                        break;
                }
            }
        }

        destroy(): void {
            clearPendingCellOpen(this.view);
            closeNestedCellEditor(this.view);
        }
    }
);

function snapshotResolvedCellRange(
    state: EditorView['state']
): { cellFrom: number; cellTo: number } | null {
    const activeCell = getActiveCell(state);
    const resolved = resolveActiveCell(state, activeCell);
    if (!resolved) {
        return null;
    }

    return {
        cellFrom: resolved.cellFrom,
        cellTo: resolved.cellTo,
    };
}
