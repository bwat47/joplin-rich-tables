export type ActiveCellFacts =
    | { status: 'absent' }
    | { status: 'unresolved' }
    | { status: 'resolved'; selectionLeftTable: boolean };

export interface TableRuntimeFacts {
    // Post-update editor state
    activeCell: ActiveCellFacts;
    hadActiveCellBeforeUpdate: boolean;
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

    // Requests
    hasInsertedTableActivation: boolean;
    openRequestId: string | null;

    // Derived policy inputs
    requiresCellReposition: boolean;
    shouldSyncMainToNested: boolean;
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

export type TableRuntimeAction =
    | { type: 'openRequestedCell'; requestId: string }
    | { type: 'closeNestedEditor' }
    | { type: 'closeNestedEditorUsingResolvedUpdateRange' }
    | { type: 'syncMainToNested' }
    | { type: 'clearActiveCell' }
    | {
          type: 'scheduleActivateCellAtCursor';
          options: ActivateCellAtCursorOptions;
      }
    | { type: 'scheduleEnsureCursorVisible'; mode: 'enteredRawMode' | 'exitedRawModeWithoutActiveCell' }
    | { type: 'scheduleRebuildAllAfterFullReplace' }
    | { type: 'scheduleInsertedTableActivation' };

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

    if (
        facts.hadActiveCellBeforeUpdate &&
        facts.hasFullDocumentReplace &&
        !facts.isNormalizeBeforeEdit &&
        !facts.pendingFullReplaceRebuild
    ) {
        actions.push({ type: 'scheduleRebuildAllAfterFullReplace' });
    }

    if (facts.rawModeTransition.exitedSourceMode || facts.rawModeTransition.exitedSearchForce) {
        actions.push({
            type: 'scheduleActivateCellAtCursor',
            options: getActivateCellAtCursorOptions('rawModeExit'),
        });
        return actions;
    }

    if (facts.rawModeTransition.enteredRawMode && !facts.isCellSelectionTransition) {
        actions.push({ type: 'scheduleEnsureCursorVisible', mode: 'enteredRawMode' });
    }

    if (
        facts.rawModeTransition.exitedRawMode &&
        facts.activeCell.status === 'absent' &&
        !facts.isCellSelectionTransition
    ) {
        actions.push({ type: 'scheduleEnsureCursorVisible', mode: 'exitedRawModeWithoutActiveCell' });
    }

    if (facts.requiresCellReposition) {
        if (facts.nestedEditorOpen) {
            actions.push({ type: 'closeNestedEditorUsingResolvedUpdateRange' });
        }
        actions.push({
            type: 'scheduleActivateCellAtCursor',
            options: getActivateCellAtCursorOptions('cellReposition'),
        });
        return actions;
    }

    if (shouldClearActiveCellWhenSelectionLeavesTable(facts)) {
        if (facts.nestedEditorOpen) {
            actions.push({ type: 'closeNestedEditor' });
        }
        actions.push({ type: 'clearActiveCell' });
        return actions;
    }

    if (facts.activeCell.status === 'absent' && facts.hadActiveCellBeforeUpdate) {
        actions.push({ type: 'closeNestedEditor' });
    }

    if (facts.shouldSyncMainToNested) {
        actions.push({ type: 'syncMainToNested' });
    }

    if (facts.docChanged && facts.activeCell.status === 'unresolved' && !facts.isSync) {
        actions.push({ type: 'clearActiveCell' });
    }

    if (facts.docChanged && facts.activeCell.status === 'resolved' && !facts.nestedEditorOpen && !facts.isSync) {
        actions.push({ type: 'clearActiveCell' });
    }

    return actions;
}

function shouldClearActiveCellWhenSelectionLeavesTable(facts: TableRuntimeFacts): boolean {
    return (
        facts.selectionChanged &&
        !facts.isSync &&
        !facts.isCellSelectionTransition &&
        !facts.effectiveRawMode &&
        facts.nestedEditorOpen &&
        selectionLeftActiveTable(facts)
    );
}

function selectionLeftActiveTable(facts: TableRuntimeFacts): boolean {
    return facts.activeCell.status === 'resolved' && facts.activeCell.selectionLeftTable;
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
