export interface TableRuntimeSnapshot {
    hasActiveCell: boolean;
    currentActiveCellResolved: boolean;
    effectiveRawMode: boolean;
    nestedEditorOpen: boolean;
    hadActiveCellBeforeUpdate: boolean;
    pendingFullReplaceRebuild: boolean;
}

export interface TableRuntimeEvent {
    docChanged: boolean;
    selectionChanged: boolean;
    isSync: boolean;
    isNormalizeBeforeEdit: boolean;
    isCellSelectionTransition: boolean;
    rawModeTransition: RawModeTransitionFacts;
    hasFullDocumentReplace: boolean;
    hasInsertedTableActivation: boolean;
    openRequestId: string | null;
    /**
     * True only when the current active cell resolved and either main
     * selection endpoint is outside that resolved table.
     */
    selectionLeftActiveTable: boolean;
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

export function reduceTableRuntime(snapshot: TableRuntimeSnapshot, event: TableRuntimeEvent): TableRuntimeAction[] {
    const actions: TableRuntimeAction[] = [];

    if (event.openRequestId) {
        // Command-driven structural mutations and direct cell activations
        // route through the explicit open path. The session controller still
        // closes the previous editor before mounting the next one, but doing
        // both in one path avoids the blur/focus gap that makes Android
        // dismiss and reopen the IME when switching cells by tap.
        actions.push({
            type: 'openRequestedCell',
            requestId: event.openRequestId,
        });
        return appendInsertedTableActivationAction(actions, event);
    }

    if (
        snapshot.hadActiveCellBeforeUpdate &&
        event.hasFullDocumentReplace &&
        !event.isNormalizeBeforeEdit &&
        !snapshot.pendingFullReplaceRebuild
    ) {
        actions.push({ type: 'scheduleRebuildAllAfterFullReplace' });
    }

    if (event.rawModeTransition.exitedSourceMode || event.rawModeTransition.exitedSearchForce) {
        actions.push({
            type: 'scheduleActivateCellAtCursor',
            options: getActivateCellAtCursorOptions('rawModeExit'),
        });
        return appendInsertedTableActivationAction(actions, event);
    }

    if (event.rawModeTransition.enteredRawMode && !event.isCellSelectionTransition) {
        actions.push({ type: 'scheduleEnsureCursorVisible', mode: 'enteredRawMode' });
    }

    if (event.rawModeTransition.exitedRawMode && !snapshot.hasActiveCell && !event.isCellSelectionTransition) {
        actions.push({ type: 'scheduleEnsureCursorVisible', mode: 'exitedRawModeWithoutActiveCell' });
    }

    if (event.requiresCellReposition) {
        if (snapshot.nestedEditorOpen) {
            actions.push({ type: 'closeNestedEditorUsingResolvedUpdateRange' });
        }
        actions.push({
            type: 'scheduleActivateCellAtCursor',
            options: getActivateCellAtCursorOptions('cellReposition'),
        });
        return appendInsertedTableActivationAction(actions, event);
    }

    if (shouldClearActiveCellWhenSelectionLeavesTable(snapshot, event)) {
        if (snapshot.nestedEditorOpen) {
            actions.push({ type: 'closeNestedEditor' });
        }
        actions.push({ type: 'clearActiveCell' });
        return appendInsertedTableActivationAction(actions, event);
    }

    if (!snapshot.hasActiveCell && snapshot.hadActiveCellBeforeUpdate) {
        actions.push({ type: 'closeNestedEditor' });
    }

    if (event.shouldSyncMainToNested) {
        actions.push({ type: 'syncMainToNested' });
    }

    if (event.docChanged && snapshot.hasActiveCell && !snapshot.currentActiveCellResolved && !event.isSync) {
        actions.push({ type: 'clearActiveCell' });
    }

    if (event.docChanged && snapshot.currentActiveCellResolved && !snapshot.nestedEditorOpen && !event.isSync) {
        actions.push({ type: 'clearActiveCell' });
    }

    return appendInsertedTableActivationAction(actions, event);
}

function shouldClearActiveCellWhenSelectionLeavesTable(state: TableRuntimeSnapshot, event: TableRuntimeEvent): boolean {
    return (
        event.selectionChanged &&
        !event.isSync &&
        !event.isCellSelectionTransition &&
        !state.effectiveRawMode &&
        state.nestedEditorOpen &&
        event.selectionLeftActiveTable
    );
}

function appendInsertedTableActivationAction(
    actions: TableRuntimeAction[],
    event: TableRuntimeEvent
): TableRuntimeAction[] {
    if (event.hasInsertedTableActivation) {
        actions.push({ type: 'scheduleInsertedTableActivation' });
    }

    return actions;
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
