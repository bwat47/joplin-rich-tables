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

export type ActivateCellAtCursorReason = 'rawModeExit' | 'cellReposition';

export type TableRuntimeAction =
    | { type: 'openRequestedCell'; requestId: string }
    | { type: 'closeNestedEditor' }
    | { type: 'closeNestedEditorUsingResolvedUpdateRange' }
    | { type: 'syncMainToNested' }
    | { type: 'clearActiveCell' }
    | {
          type: 'scheduleActivateCellAtCursor';
          reason: ActivateCellAtCursorReason;
      }
    | { type: 'scheduleEnsureCursorVisible'; mode: 'enteredRawMode' | 'exitedRawModeWithoutActiveCell' }
    | { type: 'scheduleRebuildAllAfterFullReplace' };

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
        return actions;
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
            reason: 'rawModeExit',
        });
        return actions;
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
            reason: 'cellReposition',
        });
        return actions;
    }

    if (shouldClearActiveCellWhenSelectionLeavesTable(snapshot, event)) {
        if (snapshot.nestedEditorOpen) {
            actions.push({ type: 'closeNestedEditor' });
        }
        actions.push({ type: 'clearActiveCell' });
        return actions;
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

    return actions;
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
