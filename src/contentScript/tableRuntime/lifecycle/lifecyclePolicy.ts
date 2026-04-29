import { type ActiveCell } from '../../tableState/activeCellState';

export interface TableLifecyclePolicyState {
    activeCell: ActiveCell | null;
    currentActiveCellResolved: boolean;
    effectiveRawMode: boolean;
    nestedEditorOpen: boolean;
    hadActiveCell: boolean;
    pendingFullReplaceRebuild: boolean;
}

export interface TableLifecyclePolicyEvent {
    docChanged: boolean;
    selectionChanged: boolean;
    isSync: boolean;
    isNormalizeBeforeEdit: boolean;
    isCellSelectionTransition: boolean;
    rawModeTransition: RawModeTransitionFacts;
    hasFullDocumentReplace: boolean;
    openRequestId: string | null;
    selectionLeftActiveTable: boolean;
    requiresCellReposition: boolean;
    syncIntent: NestedEditorSyncIntent;
}

export type NestedEditorSyncIntent = 'none' | 'doc' | 'selection';

export interface RawModeTransitionFacts {
    enteredRawMode: boolean;
    exitedRawMode: boolean;
    exitedSourceMode: boolean;
    exitedSearchForce: boolean;
}

export type TableRuntimeAction =
    | { type: 'openRequestedCell'; requestId: string }
    | { type: 'closeNestedEditor'; useResolvedRangeFromUpdate: boolean }
    | { type: 'syncMainToNested' }
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

export function planTableLifecycleActions(
    state: TableLifecyclePolicyState,
    event: TableLifecyclePolicyEvent
): TableRuntimeAction[] {
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
        state.hadActiveCell &&
        event.hasFullDocumentReplace &&
        !event.isNormalizeBeforeEdit &&
        !state.pendingFullReplaceRebuild
    ) {
        actions.push({ type: 'scheduleRebuildAllAfterFullReplace' });
    }

    if (event.rawModeTransition.exitedSourceMode || event.rawModeTransition.exitedSearchForce) {
        actions.push({
            type: 'scheduleActivateCellAtCursor',
            clearIfOutside: false,
            ensureCursorVisibleIfNotActivated: true,
            normalizeIfNeeded: false,
            preserveMainSelection: true,
        });
        return actions;
    }

    if (event.rawModeTransition.enteredRawMode && !event.isCellSelectionTransition) {
        actions.push({ type: 'scheduleEnsureCursorVisible', mode: 'enteredRawMode' });
    }

    if (event.rawModeTransition.exitedRawMode && !state.activeCell && !event.isCellSelectionTransition) {
        actions.push({ type: 'scheduleEnsureCursorVisible', mode: 'exitedRawModeWithoutActiveCell' });
    }

    if (event.requiresCellReposition) {
        if (state.nestedEditorOpen) {
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

    if (shouldClearActiveCellWhenSelectionLeavesTable(state, event)) {
        if (state.nestedEditorOpen) {
            actions.push({ type: 'closeNestedEditor', useResolvedRangeFromUpdate: false });
        }
        actions.push({ type: 'clearActiveCell' });
        return actions;
    }

    if (!state.activeCell && state.hadActiveCell) {
        actions.push({ type: 'closeNestedEditor', useResolvedRangeFromUpdate: false });
    }

    if (event.syncIntent === 'doc' || event.syncIntent === 'selection') {
        actions.push({ type: 'syncMainToNested' });
    }

    if (event.docChanged && state.activeCell && !state.currentActiveCellResolved && !event.isSync) {
        actions.push({ type: 'clearActiveCell' });
    }

    if (event.docChanged && state.currentActiveCellResolved && !state.nestedEditorOpen && !event.isSync) {
        actions.push({ type: 'clearActiveCell' });
    }

    return actions;
}

function shouldClearActiveCellWhenSelectionLeavesTable(
    state: TableLifecyclePolicyState,
    event: TableLifecyclePolicyEvent
): boolean {
    return (
        event.selectionChanged &&
        !event.isSync &&
        !event.isCellSelectionTransition &&
        !state.effectiveRawMode &&
        state.nestedEditorOpen &&
        event.selectionLeftActiveTable
    );
}
