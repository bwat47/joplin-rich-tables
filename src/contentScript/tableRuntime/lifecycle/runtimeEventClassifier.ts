import { type ViewUpdate } from '@codemirror/view';
import { getActiveCell, isSameActiveCell } from '../../tableState/activeCellState';
import { isCellDragInProgress } from '../../tableState/cellDragState';
import {
    exitSearchForceSourceModeEffect,
    setSearchForceSourceModeEffect,
} from '../../tableState/searchForceSourceMode';
import { exitSourceModeEffect, isEffectiveRawMode, toggleSourceModeEffect } from '../../tableState/sourceMode';
import { activateInsertedTableEffect } from '../../tableState/insertedTableActivation';
import { getResolvedActiveCell, type ResolvedActiveCell } from '../activeCell/resolvedActiveCell';
import { resolveContainingTableAtPos } from '../tableResolution';
import { hasSyncAnnotation } from '../../shared/transactionUtils';
import { transactionRequiresTableRebuild } from '../tableTransactionHelpers';
import { triggerOpenCellRequestEffect } from '../openCellRequest';
import {
    hasCellSelectionTransitionAnnotation,
    hasFullDocumentReplace,
    hasNormalizeBeforeEditAnnotation,
} from './transactionFactPredicates';
import type { ActiveCellFacts, RawModeTransitionFacts, TableRuntimeFacts } from './lifecyclePolicy';

export interface TableRuntimeExternalFacts {
    nestedEditorOpen: boolean;
    pendingFullReplaceRebuild: boolean;
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
        pendingFullReplaceRebuild: externalFacts.pendingFullReplaceRebuild,
        docChanged: update.docChanged,
        selectionChanged: update.selectionSet,
        isSync,
        isNormalizeBeforeEdit: hasNormalizeBeforeEditAnnotation(update.transactions),
        isCellSelectionTransition: hasCellSelectionTransitionAnnotation(update.transactions),
        rawModeTransition: scanRawModeTransitionFacts(update, effectiveRawMode),
        hasFullDocumentReplace: hasFullDocumentReplace(update.transactions),
        hasInsertedTableActivation: hasInsertedTableActivationEffect(update),
        openRequestId: extractOpenRequestId(update),
        rebuildTouchesPreviousActiveTable:
            update.docChanged && activeCellBeforeStatus === 'resolved'
                ? update.transactions.some((tr) => transactionRequiresTableRebuild(tr, resolvedCellBefore))
                : false,
        isUndoRedoInsideTable,
    };
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
    const status = getActiveCellStatus(activeCell, resolvedActiveCell);
    if (status !== 'resolved') {
        return { status };
    }
    return {
        status: 'resolved',
        selectionLeftActiveTable: isSelectionOutsideResolvedTable(update, resolvedActiveCell),
    };
}

function hasInsertedTableActivationEffect(update: ViewUpdate): boolean {
    return update.transactions.some((tr) => tr.effects.some((effect) => effect.is(activateInsertedTableEffect)));
}

function scanRawModeTransitionFacts(update: ViewUpdate, effectiveRawMode: boolean): RawModeTransitionFacts {
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

    const previousEffectiveRawMode = isEffectiveRawMode(update.startState);

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
    return resolveContainingTableAtPos(update.state, cursorPos) !== null;
}

function isUndoRedo(update: ViewUpdate): boolean {
    return update.transactions.some((tr) => tr.isUserEvent('undo') || tr.isUserEvent('redo'));
}
