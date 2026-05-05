import { type ViewUpdate } from '@codemirror/view';
import { getActiveCell, isSameActiveCell } from '../../tableState/activeCellState';
import { cellSelectionTransitionAnnotation } from '../../tableState/cellSelectionState';
import { syncAnnotation } from '../../editorBridge/syncAnnotation';
import {
    exitSearchForceSourceModeEffect,
    setSearchForceSourceModeEffect,
} from '../../tableState/searchForceSourceMode';
import { exitSourceModeEffect, isEffectiveRawMode, toggleSourceModeEffect } from '../../tableState/sourceMode';
import { getResolvedActiveCell, type ResolvedActiveCell } from '../activeCell/resolvedActiveCell';
import { findTableRanges } from '../tableResolution';
import { isFullDocumentReplace } from '../../shared/transactionUtils';
import { transactionRequiresTableRebuild } from '../tableTransactionHelpers';
import { triggerOpenCellRequestEffect } from '../openCellRequest';
import { normalizeBeforeEditAnnotation } from './tableNormalization';
import type { RawModeTransitionFacts, TableRuntimeEvent, TableRuntimeSnapshot } from './lifecyclePolicy';

export interface PreviousTableRuntimeState {
    nestedEditorOpen: boolean;
    hadActiveCellBeforeUpdate: boolean;
    pendingFullReplaceRebuild: boolean;
    previousEffectiveRawMode: boolean;
}

export function createTableRuntimeSnapshot(
    update: ViewUpdate,
    previous: PreviousTableRuntimeState
): TableRuntimeSnapshot {
    const activeCell = getActiveCell(update.state);
    const resolvedActiveCell = getResolvedActiveCell(update.state);
    const effectiveRawMode = isEffectiveRawMode(update.state);

    return {
        hasActiveCell: Boolean(activeCell),
        currentActiveCellResolved: Boolean(resolvedActiveCell),
        effectiveRawMode,
        nestedEditorOpen: previous.nestedEditorOpen,
        hadActiveCellBeforeUpdate: previous.hadActiveCellBeforeUpdate,
        pendingFullReplaceRebuild: previous.pendingFullReplaceRebuild,
    };
}

export function classifyTableRuntimeEvent(
    update: ViewUpdate,
    snapshot: TableRuntimeSnapshot,
    previous: PreviousTableRuntimeState
): TableRuntimeEvent {
    const activeCell = getActiveCell(update.state);
    const prevActiveCell = getActiveCell(update.startState);
    const resolvedActiveCell = getResolvedActiveCell(update.state);
    const resolvedPrevActiveCell = getResolvedActiveCell(update.startState);
    const isSync = update.transactions.some((tr) => Boolean(tr.annotation(syncAnnotation)));
    const shouldSyncDoc = update.docChanged && Boolean(resolvedActiveCell) && snapshot.nestedEditorOpen && !isSync;
    const shouldSyncSelection =
        update.selectionSet &&
        isSameActiveCell(prevActiveCell, activeCell) &&
        Boolean(resolvedActiveCell) &&
        snapshot.nestedEditorOpen &&
        !isSync;

    return {
        docChanged: update.docChanged,
        selectionChanged: update.selectionSet,
        isSync,
        isNormalizeBeforeEdit: update.transactions.some((tr) => Boolean(tr.annotation(normalizeBeforeEditAnnotation))),
        isCellSelectionTransition: update.transactions.some((tr) =>
            Boolean(tr.annotation(cellSelectionTransitionAnnotation))
        ),
        rawModeTransition: scanRawModeTransitionFacts(update, previous.previousEffectiveRawMode),
        hasFullDocumentReplace: update.transactions.some((tr) => isFullDocumentReplace(tr)),
        openRequestId: extractOpenRequestId(update),
        selectionLeftActiveTable: isSelectionOutsideResolvedTable(update, resolvedActiveCell),
        requiresCellReposition: updateRequiresCellReposition({
            update,
            effectiveRawMode: snapshot.effectiveRawMode,
            hadActiveCellBeforeUpdate: snapshot.hadActiveCellBeforeUpdate,
            resolvedPrevActiveCell,
            isSync,
        }),
        shouldSyncMainToNested: shouldSyncDoc || shouldSyncSelection,
    };
}

function scanRawModeTransitionFacts(update: ViewUpdate, previousEffectiveRawMode: boolean): RawModeTransitionFacts {
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
    hadActiveCellBeforeUpdate: boolean;
    resolvedPrevActiveCell: ResolvedActiveCell | null;
    isSync: boolean;
}): boolean {
    if (!params.update.docChanged || params.isSync || params.effectiveRawMode) {
        return false;
    }

    if (params.hadActiveCellBeforeUpdate && params.resolvedPrevActiveCell) {
        return params.update.transactions.some((tr) =>
            transactionRequiresTableRebuild(tr, params.resolvedPrevActiveCell)
        );
    }

    const isUndoRedo = params.update.transactions.some((tr) => tr.isUserEvent('undo') || tr.isUserEvent('redo'));
    return isUndoRedo && cursorInsideAnyTable(params.update);
}
