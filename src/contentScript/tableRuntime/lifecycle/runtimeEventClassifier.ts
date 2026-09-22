import { type ViewUpdate } from '@codemirror/view';
import { getActiveCell, isSameActiveCell } from '../../tableState/activeCellState';
import { containsSelection, getTableContextAtPos } from '../../tableState/tableContextField';
import { isCellDragInProgress } from '../../tableState/cellDragState';
import { exitSearchForceSourceModeEffect } from '../searchPanelTransitions';
import { exitSourceModeEffect, isEffectiveRawMode } from '../../tableState/sourceMode';
import { getResolvedActiveCell, type ResolvedActiveCell } from '../activeCell/resolvedActiveCell';
import { hasSyncAnnotation } from '../../shared/transactionUtils';
import { noteIdentityFacet } from '../../services/noteIdentity';
import { triggerOpenCellRequestEffect } from '../openCellRequest';
import { wasActiveHostInvalidated } from '../../tableWidget/tableDecorationField';
import { hasCellSelectionTransitionAnnotation } from './transactionFactPredicates';
import type { ActiveCellFacts, RawModeTransitionFacts, TableRuntimeFacts } from './lifecyclePolicy';

export interface TableRuntimeExternalFacts {
    nestedEditorOpen: boolean;
}

export function classifyTableRuntimeFacts(
    update: ViewUpdate,
    externalFacts: TableRuntimeExternalFacts
): TableRuntimeFacts {
    const activeCellBefore = getActiveCell(update.startState);
    const activeCellAfter = getActiveCell(update.state);
    const resolvedCellBefore = getResolvedActiveCell(update.startState);
    const resolvedCellAfter = getResolvedActiveCell(update.state);
    const effectiveRawMode = isEffectiveRawMode(update.state);
    const activeCellBeforeStatus = getActiveCellStatus(activeCellBefore, resolvedCellBefore);
    const isSync = hasSyncAnnotation(update.transactions);
    const activeCell = getActiveCellFacts(update, activeCellAfter, resolvedCellAfter);
    const isUndoRedoInsideTable = isUndoRedo(update) && cursorInsideAnyTable(update);

    return {
        activeCell,
        activeCellBefore: activeCellBeforeStatus,
        activeCellIdentityUnchanged: isSameActiveCell(activeCellBefore, activeCellAfter),
        effectiveRawMode,
        nestedEditorOpen: externalFacts.nestedEditorOpen,
        cellDragInProgress: isCellDragInProgress(update.state),
        docChanged: update.docChanged,
        selectionChanged: update.selectionSet,
        isSync,
        isCellSelectionTransition: hasCellSelectionTransitionAnnotation(update.transactions),
        rawModeTransition: scanRawModeTransitionFacts(update, effectiveRawMode),
        openRequestId: extractOpenRequestId(update),
        activeHostInvalidated: update.transactions.some((tr) => wasActiveHostInvalidated(tr.state)),
        isUndoRedoInsideTable,
        noteChanged: isNoteChange(update),
    };
}

/** A note switch, as opposed to the host registering its note ID for the first time. */
function isNoteChange(update: ViewUpdate): boolean {
    const previousNoteId = update.startState.facet(noteIdentityFacet);
    const currentNoteId = update.state.facet(noteIdentityFacet);
    return previousNoteId !== null && currentNoteId !== null && previousNoteId !== currentNoteId;
}

function getActiveCellStatus(
    activeCell: ReturnType<typeof getActiveCell>,
    resolvedActiveCell: ResolvedActiveCell | null
): ActiveCellFacts['status'] {
    if (!activeCell) {
        return 'absent';
    }
    return resolvedActiveCell ? 'resolved' : 'unresolved';
}

function getActiveCellFacts(
    update: ViewUpdate,
    activeCell: ReturnType<typeof getActiveCell>,
    resolvedActiveCell: ResolvedActiveCell | null
): ActiveCellFacts {
    if (!activeCell) {
        return { status: 'absent' };
    }
    if (!resolvedActiveCell) {
        return { status: 'unresolved' };
    }
    return {
        status: 'resolved',
        resolvedCell: resolvedActiveCell,
        selectionLeftActiveTable: !containsSelection(resolvedActiveCell.ctx, update.state.selection.main),
    };
}

function scanRawModeTransitionFacts(update: ViewUpdate, effectiveRawMode: boolean): RawModeTransitionFacts {
    let exitedSourceMode = false;
    let exitedSearchForce = false;

    for (const tr of update.transactions) {
        for (const effect of tr.effects) {
            if (effect.is(exitSourceModeEffect)) {
                exitedSourceMode = true;
            }
            if (effect.is(exitSearchForceSourceModeEffect)) {
                exitedSearchForce = true;
            }
        }
    }

    const previousEffectiveRawMode = isEffectiveRawMode(update.startState);

    return {
        enteredRawMode: !previousEffectiveRawMode && effectiveRawMode,
        exitedRawMode: previousEffectiveRawMode && !effectiveRawMode,
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

function cursorInsideAnyTable(update: ViewUpdate): boolean {
    const cursorPos = update.state.selection.main.head;
    return getTableContextAtPos(update.state, cursorPos) !== null;
}

function isUndoRedo(update: ViewUpdate): boolean {
    return update.transactions.some((tr) => tr.isUserEvent('undo') || tr.isUserEvent('redo'));
}
