import { ViewPlugin, EditorView, ViewUpdate } from '@codemirror/view';
import { getActiveCell, clearActiveCellEffect } from './activeCellState';
import { resolveActiveCell } from './activeCellResolver';
import { rebuildAllTableWidgetsEffect } from './tableWidgetEffects';
import {
    applyMainSelectionToNestedEditor,
    applyMainTransactionsToNestedEditor,
    closeNestedCellEditor,
    isNestedCellEditorOpen,
    openNestedCellEditor,
} from '../nestedEditor/nestedCellEditor';
import { findCellElement } from './domHelpers';
import { makeTableId } from '../tableModel/types';
import { findTableRanges } from './tablePositioning';
import { activateCellAtPosition } from './cellActivation';
import { isEffectiveRawMode } from './sourceMode';
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
            this.hadActiveCell = Boolean(getActiveCell(update.state));
            this.wasEffectiveRawMode = isEffectiveRawMode(update.state);
        }

        private executeActions(actions: readonly TableRuntimeAction[], update: ViewUpdate): void {
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
                            activateCellAtPosition(
                                this.view,
                                cursorPos,
                                action.clearIfOutside ? { clearIfOutside: true } : undefined
                            );
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
                        closeNestedCellEditor(this.view);
                        break;
                    case 'openNestedEditor':
                        requestAnimationFrame(() => {
                            if (!this.view.dom.isConnected) return;
                            const resolvedActiveCell = resolveActiveCell(this.view.state, action.activeCell);
                            if (!resolvedActiveCell) {
                                this.view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
                                return;
                            }
                            const cellElement = findCellElement(
                                this.view,
                                makeTableId(action.activeCell.tableFrom),
                                action.activeCell
                            );
                            if (!cellElement) {
                                this.view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
                                return;
                            }

                            openNestedCellEditor({
                                mainView: this.view,
                                cellElement,
                                cellFrom: resolvedActiveCell.cellFrom,
                                cellTo: resolvedActiveCell.cellTo,
                            });
                        });
                        break;
                    case 'syncMainDocToNested':
                        applyMainTransactionsToNestedEditor(this.view, {
                            transactions: update.transactions,
                            cellFrom: action.resolvedActiveCell.cellFrom,
                            cellTo: action.resolvedActiveCell.cellTo,
                        });
                        break;
                    case 'syncMainSelectionToNested':
                        applyMainSelectionToNestedEditor(this.view, {
                            selection: update.state.selection,
                            cellFrom: action.resolvedActiveCell.cellFrom,
                            cellTo: action.resolvedActiveCell.cellTo,
                            focus: action.focus,
                        });
                        break;
                    case 'clearActiveCell':
                        this.view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
                        break;
                }
            }
        }

        destroy(): void {
            closeNestedCellEditor(this.view);
        }
    }
);
