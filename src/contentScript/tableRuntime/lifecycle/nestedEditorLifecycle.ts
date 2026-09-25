import type { EditorState } from '@codemirror/state';
import { ViewPlugin, EditorView, ViewUpdate } from '@codemirror/view';
import {
    clearActiveCellEffect,
    getActiveCell,
    isSameActiveCell,
    mapActiveCellThroughChanges,
} from '../../tableState/activeCellState';
import { isEffectiveRawMode } from '../../tableState/sourceMode';
import { getResolvedActiveCell, type ResolvedActiveCell } from '../activeCell/resolvedActiveCell';
import {
    closeNestedEditor,
    handleMainEditorUpdate,
    isNestedEditorFocused,
    isNestedEditorOpen,
    openNestedEditor,
} from '../../nestedEditor/nestedEditorController';
import { findCellElement } from '../../tableWidget/domHelpers';
import { activateCellAtPosition } from '../activeCell/cellActivation';
import { clearOpenCellRequestEffect, getOpenCellRequestById } from '../openCellRequest';
import { hostEditorConfigFacet } from '../../services/hostEditorConfig';
import { reduceTableRuntime, type ActivateCellAtCursorOptions, type TableRuntimeAction } from './lifecyclePolicy';
import { classifyTableRuntimeFacts } from './runtimeEventClassifier';
import { getViewDocument, requestViewAnimationFrame } from '../../shared/domContext';
import { getPositionOutsideTable } from '../navigation/cursorUtils';
import { hasPlainRenderedTableCaret } from '../renderedTableCaret';
import { logger } from '../../../logger';

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

/** True when focus sits on no element, as it does after the focused element is removed. */
function hasUnownedFocus(view: EditorView): boolean {
    const doc = getViewDocument(view);
    return doc.activeElement === null || doc.activeElement === doc.body;
}

/** Why a document appeared under the runtime with a cursor that may sit inside a table. */
type TableExitCleanupReason = 'note switch' | 'editor init';

/**
 * True when the main selection is a bare caret that no table owner put there.
 *
 * This is the shape the host restores a cursor in. A selection, even a collapsed one another
 * owner is holding, came from something that meant to be inside the table.
 */
function isRestoredCaret(state: EditorState): boolean {
    return state.selection.main.empty && hasPlainRenderedTableCaret(state);
}

interface OpenRequestExecutionGuardResult {
    request: NonNullable<ReturnType<typeof getOpenCellRequestById>>;
    resolvedCell: ResolvedActiveCell;
    cellElement: HTMLElement;
}

// ============================================================================
// Plugin Definition
// ============================================================================

export const nestedEditorLifecyclePlugin = ViewPlugin.fromClass(
    class {
        constructor(private view: EditorView) {
            // A fresh editor arrives with whatever cursor the host restored, which can sit inside
            // a table. The note-switch path cannot cover this: its facet transition happens in the
            // transaction that registers this plugin, and CodeMirror does not call `update()` for
            // the transaction that installs a plugin.
            this.scheduleTableExitCleanup('editor init');
        }

        update(update: ViewUpdate): void {
            const facts = classifyTableRuntimeFacts(update, {
                nestedEditorOpen: isNestedEditorOpen(this.view),
            });
            const actions = reduceTableRuntime(facts);

            this.executeActions(actions, update);
        }

        private executeActions(actions: readonly TableRuntimeAction[], update: ViewUpdate): void {
            for (const action of actions) {
                switch (action.type) {
                    case 'scheduleActivateCellAtCursor':
                        this.scheduleActivateCellAtCursor(update, action.options);
                        break;
                    case 'scheduleEnsureCursorVisible':
                        this.scheduleEnsureCursorVisible(action.mode);
                        break;
                    case 'closeNestedEditor':
                        this.closeNestedEditor(action);
                        break;
                    case 'openRequestedCell':
                        this.scheduleOpenRequestedCell(action.requestId);
                        break;
                    case 'syncMainToNested':
                        handleMainEditorUpdate(this.view, update, action.resolvedCell);
                        break;
                    case 'clearActiveCell':
                        requestViewAnimationFrame(this.view, () => {
                            if (!this.view.dom.isConnected) return;
                            this.view.dispatch({ effects: clearActiveCellEffect.of(null) });
                        });
                        break;
                    case 'scheduleNoteSwitchCleanup':
                        this.scheduleTableExitCleanup('note switch');
                        break;
                }
            }
        }

        private closeNestedEditor(action: Extract<TableRuntimeAction, { type: 'closeNestedEditor' }>): void {
            const restoreFocus = action.restoreMainFocus === true && isNestedEditorFocused(this.view);
            closeNestedEditor(this.view, action.mappedRange);
            if (!restoreFocus) return;

            // Destroying the focused nested editor drops focus to the document body. Focus is
            // restored after the update, and only if nothing else has claimed it meanwhile.
            requestViewAnimationFrame(this.view, () => {
                if (!this.view.dom.isConnected || !hasUnownedFocus(this.view)) return;
                this.view.focus();
            });
        }

        /**
         * Leaves a newly shown document with no table state carried into it: the cursor moves out
         * of any table it landed in, and a leftover active cell is cleared.
         *
         * Runs for both documents that appear under the runtime - a note switch, and the editor's
         * own registration. Reads the state when it runs, so a selection the host restored
         * afterwards is respected, and a cursor already outside every table is left alone along
         * with focus and scroll.
         */
        private scheduleTableExitCleanup(reason: TableExitCleanupReason): void {
            requestViewAnimationFrame(this.view, () => {
                if (!this.view.dom.isConnected) return;

                // Registration brings no table state of its own, so anything live by the time this
                // runs was established after it: an owned table, or a selection someone made or
                // preserved, and in both cases the caret is inside the table on purpose. Only a
                // restored caret is this path's to move. A note switch is the opposite - the state
                // it finds belongs to the note being left, so it clears it.
                if (reason === 'editor init' && !isRestoredCaret(this.view.state)) return;

                const positionOutsideTable = getPositionOutsideTable(this.view.state);
                const hasActiveCell = getActiveCell(this.view.state) !== null;
                if (positionOutsideTable === null && !hasActiveCell) return;

                this.view.dispatch({
                    selection: positionOutsideTable === null ? undefined : { anchor: positionOutsideTable },
                    effects: hasActiveCell ? clearActiveCellEffect.of(null) : [],
                });
                if (positionOutsideTable !== null) {
                    logger.debug('Moved cursor out of table', { reason });
                }
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
                    entryMode: activateOptions.entryMode,
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

        /**
         * Mounts the cell editor in a microtask rather than on the next frame.
         *
         * CodeMirror finishes rebuilding the widget DOM synchronously before `update()` returns,
         * so the cell element is already there when the microtask runs. Waiting for a frame instead
         * leaves the main editor holding focus with the caret parked in the table's replaced range,
         * and characters typed in that window land outside the table.
         */
        private scheduleOpenRequestedCell(requestId: string): void {
            queueMicrotask(() => {
                const guardResult = this.validateOpenRequestForExecution(requestId);
                if (!guardResult) {
                    return;
                }

                const opened = openNestedEditor({
                    mainView: this.view,
                    cellElement: guardResult.cellElement,
                    resolvedCell: guardResult.resolvedCell,
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
                this.view.dispatch({ effects: clearActiveCellEffect.of(null) });
                return null;
            }

            const cellElement = findCellElement(this.view, targetActiveCell.tableFrom, targetActiveCell);
            if (!cellElement) {
                this.failOpenRequest(requestId);
                this.view.dispatch({ effects: clearActiveCellEffect.of(null) });
                return null;
            }

            return {
                request,
                resolvedCell: resolvedActiveCell,
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
