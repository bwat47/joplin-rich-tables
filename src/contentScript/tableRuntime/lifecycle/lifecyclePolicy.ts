import { Transaction } from '@codemirror/state';
import { ViewUpdate } from '@codemirror/view';
import { getActiveCell, isSameActiveCell, type ActiveCell } from '../../tableState/activeCellState';
import { cellSelectionTransitionAnnotation } from '../../tableState/cellSelectionState';
import {
    exitSearchForceSourceModeEffect,
    setSearchForceSourceModeEffect,
} from '../../tableState/searchForceSourceMode';
import { exitSourceModeEffect, isEffectiveRawMode, toggleSourceModeEffect } from '../../tableState/sourceMode';
import { rebuildTableWidgetsEffect } from '../../tableState/tableWidgetEffects';
import { syncAnnotation } from '../../editorBridge/syncAnnotation';
import { type ResolvedActiveCell } from '../activeCell/activeCellResolver';
import { getResolvedActiveCell } from '../activeCell/resolvedActiveCellField';
import { isFullDocumentReplace } from '../../shared/transactionUtils';
import { normalizeBeforeEditAnnotation } from './tableNormalization';
import { requestOpenActiveCellEffect, type OpenActiveCellRequest } from '../activeCell/activeCellOpen';
import { transactionRequiresTableRebuild } from '../tableTransactionHelpers';

export interface TableRuntimeSnapshot {
    activeCell: ActiveCell | null;
    prevActiveCell: ActiveCell | null;
    resolvedActiveCell: ResolvedActiveCell | null;
    resolvedPrevActiveCell: ResolvedActiveCell | null;
    effectiveRawMode: boolean;
    nestedEditorOpen: boolean;
    hadActiveCell: boolean;
    pendingFullReplaceRebuild: boolean;
}

export interface TableRuntimeEvent {
    update: ViewUpdate;
    isSync: boolean;
    isNormalizeBeforeEdit: boolean;
    isCellSelectionTransition: boolean;
    forceRebuild: boolean;
    rawModeEffects: RawModeEffects;
    enteredRawMode: boolean;
    exitedRawMode: boolean;
    hasFullDocumentReplace: boolean;
    openRequest: OpenActiveCellRequest | null;
}

export interface RawModeEffects {
    exitedSourceMode: boolean;
    exitedSearchForce: boolean;
    hadRawModeToggle: boolean;
}

export type TableRuntimeAction =
    | { type: 'openNestedEditor'; requestId?: string; activeCell: ActiveCell; normalizeIfNeeded: boolean }
    | { type: 'closeNestedEditor'; useResolvedRangeFromUpdate: boolean }
    | { type: 'syncMainDocToNested' }
    | { type: 'syncMainSelectionToNested' }
    | { type: 'clearActiveCell' }
    | {
          type: 'scheduleActivateCellAtCursor';
          clearIfOutside: boolean;
          ensureCursorVisibleIfNotActivated: boolean;
          normalizeIfNeeded: boolean;
          preserveMainSelection: boolean;
      }
    | { type: 'scheduleEnsureCursorVisible'; mode: 'enteredRawMode' | 'exitedRawModeWithoutActiveCell' }
    | { type: 'scheduleRebuildAllAfterFullReplace' };

function scanRawModeEffects(transactions: readonly Transaction[]): RawModeEffects {
    let exitedSourceMode = false;
    let exitedSearchForce = false;
    let hadRawModeToggle = false;

    for (const tr of transactions) {
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

    return { exitedSourceMode, exitedSearchForce, hadRawModeToggle };
}

function extractOpenRequest(update: ViewUpdate): OpenActiveCellRequest | null {
    for (const tr of update.transactions) {
        for (const effect of tr.effects) {
            if (effect.is(requestOpenActiveCellEffect)) {
                return effect.value;
            }
        }
    }

    return null;
}

export function buildTableRuntimeSnapshot(params: {
    update: ViewUpdate;
    nestedEditorOpen: boolean;
    hadActiveCell: boolean;
    pendingFullReplaceRebuild: boolean;
}): TableRuntimeSnapshot {
    const activeCell = getActiveCell(params.update.state);
    const prevActiveCell = getActiveCell(params.update.startState);

    return {
        activeCell,
        prevActiveCell,
        resolvedActiveCell: getResolvedActiveCell(params.update.state),
        resolvedPrevActiveCell: getResolvedActiveCell(params.update.startState),
        effectiveRawMode: isEffectiveRawMode(params.update.state),
        nestedEditorOpen: params.nestedEditorOpen,
        hadActiveCell: params.hadActiveCell,
        pendingFullReplaceRebuild: params.pendingFullReplaceRebuild,
    };
}

export function buildTableRuntimeEvent(update: ViewUpdate, previousEffectiveRawMode: boolean): TableRuntimeEvent {
    const rawModeEffects = scanRawModeEffects(update.transactions);

    return {
        update,
        isSync: update.transactions.some((tr) => Boolean(tr.annotation(syncAnnotation))),
        isNormalizeBeforeEdit: update.transactions.some((tr) => Boolean(tr.annotation(normalizeBeforeEditAnnotation))),
        isCellSelectionTransition: update.transactions.some((tr) =>
            Boolean(tr.annotation(cellSelectionTransitionAnnotation))
        ),
        forceRebuild: update.transactions.some((tr) =>
            tr.effects.some((effect) => effect.is(rebuildTableWidgetsEffect))
        ),
        rawModeEffects,
        enteredRawMode:
            rawModeEffects.hadRawModeToggle && !previousEffectiveRawMode && isEffectiveRawMode(update.state),
        exitedRawMode: rawModeEffects.hadRawModeToggle && previousEffectiveRawMode && !isEffectiveRawMode(update.state),
        hasFullDocumentReplace: update.transactions.some((tr) => isFullDocumentReplace(tr)),
        openRequest: extractOpenRequest(update),
    };
}

export function planTableLifecycleActions(
    snapshot: TableRuntimeSnapshot,
    event: TableRuntimeEvent,
    options: { cursorInsideTableAfterUndoRedo: boolean }
): TableRuntimeAction[] {
    const { update, rawModeEffects } = event;
    const actions: TableRuntimeAction[] = [];

    if (event.openRequest) {
        // Command-driven structural mutations and direct cell activations
        // route through the explicit open path. The session controller still
        // closes the previous editor before mounting the next one, but doing
        // both in one path avoids the blur/focus gap that makes Android
        // dismiss and reopen the IME when switching cells by tap.
        actions.push({
            type: 'openNestedEditor',
            requestId: event.openRequest.requestId,
            activeCell: event.openRequest.activeCell,
            normalizeIfNeeded: event.openRequest.normalizeIfNeeded,
        });
        return actions;
    }

    if (
        snapshot.hadActiveCell &&
        event.hasFullDocumentReplace &&
        !event.isNormalizeBeforeEdit &&
        !snapshot.pendingFullReplaceRebuild
    ) {
        actions.push({ type: 'scheduleRebuildAllAfterFullReplace' });
    }

    if (rawModeEffects.exitedSourceMode || rawModeEffects.exitedSearchForce) {
        actions.push({
            type: 'scheduleActivateCellAtCursor',
            clearIfOutside: false,
            ensureCursorVisibleIfNotActivated: true,
            normalizeIfNeeded: false,
            preserveMainSelection: true,
        });
        return actions;
    }

    if (event.enteredRawMode && !event.isCellSelectionTransition) {
        actions.push({ type: 'scheduleEnsureCursorVisible', mode: 'enteredRawMode' });
    }

    if (event.exitedRawMode && !snapshot.activeCell && !event.isCellSelectionTransition) {
        actions.push({ type: 'scheduleEnsureCursorVisible', mode: 'exitedRawModeWithoutActiveCell' });
    }

    if (shouldRepositionCellAfterUndoRedo(snapshot, event, options.cursorInsideTableAfterUndoRedo)) {
        if (snapshot.nestedEditorOpen) {
            actions.push({ type: 'closeNestedEditor', useResolvedRangeFromUpdate: true });
        }
        actions.push({
            type: 'scheduleActivateCellAtCursor',
            clearIfOutside: true,
            ensureCursorVisibleIfNotActivated: false,
            normalizeIfNeeded: false,
            preserveMainSelection: false,
        });
        return actions;
    }

    if (event.forceRebuild && snapshot.activeCell && !event.isSync) {
        // Fallback for rebuild-only transitions such as recovery and
        // non-command table state restoration.
        if (snapshot.nestedEditorOpen) {
            actions.push({ type: 'closeNestedEditor', useResolvedRangeFromUpdate: false });
        }
        actions.push({
            type: 'openNestedEditor',
            activeCell: snapshot.activeCell,
            normalizeIfNeeded: false,
        });
        return actions;
    }

    if (shouldClearActiveCellWhenSelectionLeavesTable(snapshot, event)) {
        if (snapshot.nestedEditorOpen) {
            actions.push({ type: 'closeNestedEditor', useResolvedRangeFromUpdate: false });
        }
        actions.push({ type: 'clearActiveCell' });
        return actions;
    }

    if (!snapshot.activeCell && snapshot.hadActiveCell) {
        actions.push({ type: 'closeNestedEditor', useResolvedRangeFromUpdate: false });
    }

    if (update.docChanged && snapshot.resolvedActiveCell && snapshot.nestedEditorOpen && !event.isSync) {
        actions.push({ type: 'syncMainDocToNested' });
    } else {
        const sameActiveCell = isSameActiveCell(snapshot.prevActiveCell, snapshot.activeCell);
        if (
            update.selectionSet &&
            sameActiveCell &&
            snapshot.resolvedActiveCell &&
            snapshot.nestedEditorOpen &&
            !event.isSync
        ) {
            actions.push({ type: 'syncMainSelectionToNested' });
        }
    }

    if (update.docChanged && snapshot.activeCell && !snapshot.resolvedActiveCell && !event.isSync) {
        actions.push({ type: 'clearActiveCell' });
    }

    if (update.docChanged && snapshot.resolvedActiveCell && !snapshot.nestedEditorOpen && !event.isSync) {
        actions.push({ type: 'clearActiveCell' });
    }

    return actions;
}

function shouldRepositionCellAfterUndoRedo(
    snapshot: TableRuntimeSnapshot,
    event: TableRuntimeEvent,
    cursorInsideTableAfterUndoRedo: boolean
): boolean {
    const { update, isSync } = event;

    if (!update.docChanged || isSync || snapshot.effectiveRawMode) {
        return false;
    }

    if (snapshot.hadActiveCell && snapshot.resolvedPrevActiveCell) {
        return update.transactions.some((tr) => transactionRequiresTableRebuild(tr, snapshot.resolvedPrevActiveCell));
    }

    const isUndoRedo = update.transactions.some((tr) => tr.isUserEvent('undo') || tr.isUserEvent('redo'));
    return isUndoRedo && cursorInsideTableAfterUndoRedo;
}

function shouldClearActiveCellWhenSelectionLeavesTable(
    snapshot: TableRuntimeSnapshot,
    event: TableRuntimeEvent
): boolean {
    const { update, isSync, isCellSelectionTransition } = event;
    if (
        !update.selectionSet ||
        isSync ||
        isCellSelectionTransition ||
        snapshot.effectiveRawMode ||
        !snapshot.nestedEditorOpen
    ) {
        return false;
    }

    const resolved = snapshot.resolvedActiveCell;
    if (!resolved) {
        return false;
    }

    const { main } = update.state.selection;
    return (
        !isPositionInsideRange(main.anchor, resolved.tableFrom, resolved.tableTo) ||
        !isPositionInsideRange(main.head, resolved.tableFrom, resolved.tableTo)
    );
}

function isPositionInsideRange(pos: number, from: number, to: number): boolean {
    return pos >= from && pos <= to;
}
