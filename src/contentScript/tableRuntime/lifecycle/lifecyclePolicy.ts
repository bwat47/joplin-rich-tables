export type ActiveCellFacts =
    | { status: 'absent' }
    | { status: 'unresolved' }
    | {
          status: 'resolved';
          // True when either main-selection endpoint is outside the resolved table.
          selectionLeftActiveTable: boolean;
      };

export interface TableRuntimeFacts {
    // Post-update editor state
    activeCell: ActiveCellFacts;
    activeCellBefore: ActiveCellFacts['status'];
    activeCellIdentityUnchanged: boolean;
    effectiveRawMode: boolean;

    // External facts supplied by the lifecycle plugin
    nestedEditorOpen: boolean;
    pendingFullReplaceRebuild: boolean;

    // Transaction facts
    docChanged: boolean;
    selectionChanged: boolean;
    isSync: boolean;
    isNormalizeBeforeEdit: boolean;
    isCellSelectionTransition: boolean;
    rawModeTransition: RawModeTransitionFacts;
    hasFullDocumentReplace: boolean;
    rebuildTouchesPreviousActiveTable: boolean;
    isUndoRedoInsideTable: boolean;

    // Requests
    hasInsertedTableActivation: boolean;
    openRequestId: string | null;
}

export interface RawModeTransitionFacts {
    enteredRawMode: boolean;
    exitedRawMode: boolean;
    exitedSourceMode: boolean;
    exitedSearchForce: boolean;
}

type ActivateCellAtCursorReason = 'rawModeExit' | 'cellReposition';

export interface ActivateCellAtCursorOptions {
    clearIfOutside: boolean;
    ensureCursorVisibleIfNotActivated: boolean;
    normalizeIfNeeded: boolean;
    preserveMainSelection: boolean;
}

type NestedEditorCloseReason = 'cellReposition' | 'selectionLeftActiveTable' | 'activeCellRemoved';

export type TableRuntimeAction =
    | { type: 'openRequestedCell'; requestId: string }
    | { type: 'closeNestedEditor'; reason: NestedEditorCloseReason }
    | { type: 'syncMainToNested' }
    | { type: 'clearActiveCell' }
    | {
          type: 'scheduleActivateCellAtCursor';
          options: ActivateCellAtCursorOptions;
      }
    | { type: 'scheduleEnsureCursorVisible'; mode: 'enteredRawMode' | 'exitedRawModeWithoutActiveCell' }
    | { type: 'scheduleRebuildAllAfterFullReplace' }
    | { type: 'scheduleInsertedTableActivation' };

// Precedence:
// 1. Explicit open requests short-circuit all but inserted-table activation.
// 2. Accumulating full-replace rebuild and visibility work precedes terminal raw-mode
//    exit, reposition, or selection-departure transitions (the first match returns).
// 3. Continuing close, sync, and stale-clear actions follow; inserted-table activation
//    is independently appended.
export function reduceTableRuntime(facts: TableRuntimeFacts): TableRuntimeAction[] {
    const actions = reduceCoreTableRuntime(facts);
    if (facts.hasInsertedTableActivation) {
        return [...actions, { type: 'scheduleInsertedTableActivation' }];
    }

    return actions;
}

function reduceCoreTableRuntime(facts: TableRuntimeFacts): TableRuntimeAction[] {
    const actions: TableRuntimeAction[] = [];

    if (facts.openRequestId) {
        // Command-driven structural mutations and direct cell activations
        // route through the explicit open path. The session controller still
        // closes the previous editor before mounting the next one, but doing
        // both in one path avoids the blur/focus gap that makes Android
        // dismiss and reopen the IME when switching cells by tap.
        actions.push({
            type: 'openRequestedCell',
            requestId: facts.openRequestId,
        });
        return actions;
    }

    if (shouldRebuildAllAfterFullReplace(facts)) {
        actions.push({ type: 'scheduleRebuildAllAfterFullReplace' });
    }

    if (exitedForcedRawMode(facts)) {
        actions.push({
            type: 'scheduleActivateCellAtCursor',
            options: getActivateCellAtCursorOptions('rawModeExit'),
        });
        return actions;
    }

    const ensureCursorVisibleMode = getEnsureCursorVisibleMode(facts);
    if (ensureCursorVisibleMode) {
        actions.push({ type: 'scheduleEnsureCursorVisible', mode: ensureCursorVisibleMode });
    }

    if (requiresCellReposition(facts)) {
        if (facts.nestedEditorOpen) {
            actions.push({ type: 'closeNestedEditor', reason: 'cellReposition' });
        }
        actions.push({
            type: 'scheduleActivateCellAtCursor',
            options: getActivateCellAtCursorOptions('cellReposition'),
        });
        return actions;
    }

    if (shouldClearActiveCellWhenSelectionLeavesTable(facts)) {
        if (facts.nestedEditorOpen) {
            actions.push({ type: 'closeNestedEditor', reason: 'selectionLeftActiveTable' });
        }
        actions.push({ type: 'clearActiveCell' });
        return actions;
    }

    if (activeCellWasRemoved(facts)) {
        actions.push({ type: 'closeNestedEditor', reason: 'activeCellRemoved' });
    }

    if (shouldSyncMainToNested(facts)) {
        actions.push({ type: 'syncMainToNested' });
    }

    if (shouldClearStaleActiveCell(facts)) {
        actions.push({ type: 'clearActiveCell' });
    }

    return actions;
}

function shouldRebuildAllAfterFullReplace(facts: TableRuntimeFacts): boolean {
    return (
        facts.activeCellBefore !== 'absent' &&
        facts.hasFullDocumentReplace &&
        !facts.isNormalizeBeforeEdit &&
        !facts.pendingFullReplaceRebuild
    );
}

// Source-mode and search-force exits bypass the normal raw-mode exit flow and
// reactivate the cell under the cursor directly.
function exitedForcedRawMode(facts: TableRuntimeFacts): boolean {
    return facts.rawModeTransition.exitedSourceMode || facts.rawModeTransition.exitedSearchForce;
}

function getEnsureCursorVisibleMode(
    facts: TableRuntimeFacts
): 'enteredRawMode' | 'exitedRawModeWithoutActiveCell' | null {
    if (facts.isCellSelectionTransition) {
        return null;
    }
    if (facts.rawModeTransition.enteredRawMode) {
        return 'enteredRawMode';
    }
    if (facts.rawModeTransition.exitedRawMode && facts.activeCell.status === 'absent') {
        return 'exitedRawModeWithoutActiveCell';
    }
    return null;
}

function activeCellWasRemoved(facts: TableRuntimeFacts): boolean {
    return facts.activeCell.status === 'absent' && facts.activeCellBefore !== 'absent';
}

// After a document change outside the sync path, an active cell that no longer
// resolves (or resolves without a nested editor to keep it alive) is stale.
function shouldClearStaleActiveCell(facts: TableRuntimeFacts): boolean {
    if (!facts.docChanged || facts.isSync) {
        return false;
    }
    if (facts.activeCell.status === 'unresolved') {
        return true;
    }
    return facts.activeCell.status === 'resolved' && !facts.nestedEditorOpen;
}

function shouldSyncMainToNested(facts: TableRuntimeFacts): boolean {
    return (
        facts.nestedEditorOpen &&
        !facts.isSync &&
        facts.activeCell.status === 'resolved' &&
        (facts.docChanged || (facts.selectionChanged && facts.activeCellIdentityUnchanged))
    );
}

function requiresCellReposition(facts: TableRuntimeFacts): boolean {
    if (!facts.docChanged || facts.isSync || facts.effectiveRawMode) {
        return false;
    }

    return facts.activeCellBefore === 'resolved'
        ? facts.rebuildTouchesPreviousActiveTable
        : facts.isUndoRedoInsideTable;
}

function shouldClearActiveCellWhenSelectionLeavesTable(facts: TableRuntimeFacts): boolean {
    return (
        facts.selectionChanged &&
        !facts.isSync &&
        !facts.isCellSelectionTransition &&
        !facts.effectiveRawMode &&
        facts.nestedEditorOpen &&
        facts.activeCell.status === 'resolved' &&
        facts.activeCell.selectionLeftActiveTable
    );
}

function getActivateCellAtCursorOptions(reason: ActivateCellAtCursorReason): ActivateCellAtCursorOptions {
    if (reason === 'rawModeExit') {
        return {
            clearIfOutside: false,
            ensureCursorVisibleIfNotActivated: true,
            normalizeIfNeeded: false,
            preserveMainSelection: true,
        };
    }

    return {
        clearIfOutside: true,
        ensureCursorVisibleIfNotActivated: false,
        normalizeIfNeeded: false,
        preserveMainSelection: false,
    };
}
