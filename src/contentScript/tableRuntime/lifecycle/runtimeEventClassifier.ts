import { type ViewUpdate } from '@codemirror/view';
import { getActiveCell, isSameActiveCell } from '../../tableState/activeCellState';
import { cellSelectionTransitionAnnotation } from '../../tableState/cellSelectionState';
import { syncAnnotation } from '../../editorBridge/syncAnnotation';
import {
    exitSearchForceSourceModeEffect,
    setSearchForceSourceModeEffect,
} from '../../tableState/searchForceSourceMode';
import { exitSourceModeEffect, isEffectiveRawMode, toggleSourceModeEffect } from '../../tableState/sourceMode';
import { activateInsertedTableEffect } from '../../tableState/insertedTableActivation';
import { getResolvedActiveCell, type ResolvedActiveCell } from '../activeCell/resolvedActiveCell';
import { findTableRanges } from '../tableResolution';
import { isFullDocumentReplace } from '../../shared/transactionUtils';
import { transactionRequiresTableRebuild } from '../tableTransactionHelpers';
import { triggerOpenCellRequestEffect } from '../openCellRequest';
import { normalizeBeforeEditAnnotation } from './tableNormalization';
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
    const isSync = hasSyncAnnotation(update);
    const activeCell = getActiveCellFacts(update, activeCellAfter, resolvedCellAfter);
    const shouldSyncDoc = update.docChanged && Boolean(resolvedCellAfter) && externalFacts.nestedEditorOpen && !isSync;
    const shouldSyncSelection =
        update.selectionSet &&
        isSameActiveCell(activeCellBefore, activeCellAfter) &&
        Boolean(resolvedCellAfter) &&
        externalFacts.nestedEditorOpen &&
        !isSync;

    return {
        activeCell,
        hadActiveCellBeforeUpdate: Boolean(activeCellBefore),
        effectiveRawMode,
        nestedEditorOpen: externalFacts.nestedEditorOpen,
        pendingFullReplaceRebuild: externalFacts.pendingFullReplaceRebuild,
        docChanged: update.docChanged,
        selectionChanged: update.selectionSet,
        isSync,
        isNormalizeBeforeEdit: update.transactions.some((tr) => Boolean(tr.annotation(normalizeBeforeEditAnnotation))),
        isCellSelectionTransition: update.transactions.some((tr) =>
            Boolean(tr.annotation(cellSelectionTransitionAnnotation))
        ),
        rawModeTransition: scanRawModeTransitionFacts(update),
        hasFullDocumentReplace: update.transactions.some((tr) => isFullDocumentReplace(tr)),
        hasInsertedTableActivation: hasInsertedTableActivationEffect(update),
        openRequestId: extractOpenRequestId(update),
        requiresCellReposition: updateRequiresCellReposition({
            update,
            effectiveRawMode,
            hadActiveCellBeforeUpdate: Boolean(activeCellBefore),
            resolvedActiveCellBefore: resolvedCellBefore,
            isSync,
        }),
        shouldSyncMainToNested: shouldSyncDoc || shouldSyncSelection,
    };
}

function hasSyncAnnotation(update: ViewUpdate): boolean {
    return update.transactions.some((tr) => Boolean(tr.annotation(syncAnnotation)));
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
        selectionLeftTable: isSelectionOutsideResolvedTable(update, resolvedActiveCell),
    };
}

function hasInsertedTableActivationEffect(update: ViewUpdate): boolean {
    return update.transactions.some((tr) => tr.effects.some((effect) => effect.is(activateInsertedTableEffect)));
}

function scanRawModeTransitionFacts(update: ViewUpdate): RawModeTransitionFacts {
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
    resolvedActiveCellBefore: ResolvedActiveCell | null;
    isSync: boolean;
}): boolean {
    if (!params.update.docChanged || params.isSync || params.effectiveRawMode) {
        return false;
    }

    if (params.hadActiveCellBeforeUpdate && params.resolvedActiveCellBefore) {
        return params.update.transactions.some((tr) =>
            transactionRequiresTableRebuild(tr, params.resolvedActiveCellBefore)
        );
    }

    const isUndoRedo = params.update.transactions.some((tr) => tr.isUserEvent('undo') || tr.isUserEvent('redo'));
    return isUndoRedo && cursorInsideAnyTable(params.update);
}
