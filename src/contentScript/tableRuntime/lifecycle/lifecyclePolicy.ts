import type { CellEntryMode } from '../openCellRequest';
import type { CellContentRange, ResolvedActiveCell } from '../activeCell/resolvedActiveCell';

export type ActiveCellFacts =
    | { status: 'absent' }
    | { status: 'unresolved' }
    | {
          status: 'resolved';
          resolvedCell: ResolvedActiveCell;
          // True when either main-selection endpoint is outside the resolved table.
          selectionLeftActiveTable: boolean;
      };

type ResolvedActiveCellFacts = Extract<ActiveCellFacts, { status: 'resolved' }>;

export interface TableRuntimeFacts {
    // Post-update editor state
    activeCell: ActiveCellFacts;
    activeCellBefore: ActiveCellFacts['status'];
    activeCellIdentityUnchanged: boolean;
    effectiveRawMode: boolean;

    // External facts supplied by the lifecycle plugin
    nestedEditorOpen: boolean;
    // A mouse drag is sweeping out a cell selection and owns the table's geometry until release.
    cellDragInProgress: boolean;

    // Transaction facts
    docChanged: boolean;
    selectionChanged: boolean;
    isSync: boolean;
    isCellSelectionTransition: boolean;
    rawModeTransition: RawModeTransitionFacts;
    // A document change rebuilt or dropped the decoration hosting the previously active cell.
    activeHostInvalidated: boolean;
    isUndoRedoInsideTable: boolean;
    // The editor switched to a different note; the replaced document belongs to it.
    noteChanged: boolean;

    // Requests
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
    /** Lifecycle reactivation never repairs: the frame it runs in no longer owns the event. */
    entryMode: Extract<CellEntryMode, 'enter' | 'adopt'>;
}

export type TableRuntimeAction =
    | { type: 'openRequestedCell'; requestId: string }
    | {
          type: 'closeNestedEditor';
          // Set for closes whose widget stays mounted, so the re-rendered text lands in the cell's
          // range after the update.
          mappedRange?: CellContentRange;
          // Set when nothing else takes focus after the close, so a focused nested editor hands
          // it back to the main editor instead of dropping it to the document body.
          restoreMainFocus?: boolean;
      }
    | { type: 'syncMainToNested'; resolvedCell: ResolvedActiveCell }
    | { type: 'clearActiveCell' }
    | {
          type: 'scheduleActivateCellAtCursor';
          options: ActivateCellAtCursorOptions;
      }
    | { type: 'scheduleEnsureCursorVisible'; mode: 'enteredRawMode' | 'exitedRawModeWithoutActiveCell' }
    | { type: 'scheduleNoteSwitchCleanup' };

// Precedence:
// 1. A note switch short-circuits everything: no cell from the previous note is reopened.
// 2. Explicit open requests short-circuit remaining lifecycle work.
// 3. Forced raw-mode exit is terminal. Otherwise cursor-visibility work accumulates
//    before the terminal reposition or selection-departure transitions (the first match returns).
// 4. Continuing close, sync, and stale-clear actions follow.
export function reduceTableRuntime(facts: TableRuntimeFacts): TableRuntimeAction[] {
    if (facts.noteChanged) {
        return reduceNoteSwitch(facts);
    }

    return reduceCoreTableRuntime(facts);
}

// The replaced document belongs to another note, so the cursor it carries says nothing about
// which cell the user wants. Cleanup reads the settled state instead of reactivating a cell.
function reduceNoteSwitch(facts: TableRuntimeFacts): TableRuntimeAction[] {
    const cleanup: TableRuntimeAction = { type: 'scheduleNoteSwitchCleanup' };
    if (facts.nestedEditorOpen) {
        return [{ type: 'closeNestedEditor' }, cleanup];
    }

    return [cleanup];
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
            actions.push({
                type: 'closeNestedEditor',
                mappedRange: getMappedCellRange(facts.activeCell),
            });
        }
        actions.push({
            type: 'scheduleActivateCellAtCursor',
            options: getActivateCellAtCursorOptions('cellReposition'),
        });
        return actions;
    }

    if (shouldClearActiveCellWhenSelectionLeavesTable(facts)) {
        // A programmatic selection move (find next, a host jump) leaves the table with no focus
        // owner of its own, unlike a click or arrow exit.
        actions.push({
            type: 'closeNestedEditor',
            mappedRange: getMappedCellRange(facts.activeCell),
            restoreMainFocus: true,
        });
        actions.push({ type: 'clearActiveCell' });
        return actions;
    }

    if (activeCellWasRemoved(facts)) {
        actions.push({ type: 'closeNestedEditor' });
    }

    if (shouldSyncMainToNested(facts)) {
        actions.push({ type: 'syncMainToNested', resolvedCell: facts.activeCell.resolvedCell });
    }

    if (shouldClearStaleActiveCell(facts)) {
        actions.push({ type: 'clearActiveCell' });
    }

    return actions;
}

/**
 * The active cell's range after the update, for closes whose widget can stay mounted so the text
 * re-rendered into the cell is what the user sees.
 *
 * These closes run inside the update that triggered them, before the controller syncs the session
 * from it, so the session's cached cell still reflects the start state. The cell classified from
 * the post-update state is the session's own cell mapped through the transaction, so its range is
 * correct even when the same transaction edited the document or shifted the table.
 */
function getMappedCellRange(activeCell: ActiveCellFacts): CellContentRange | undefined {
    if (activeCell.status !== 'resolved') {
        return undefined;
    }

    return {
        contentFrom: activeCell.resolvedCell.contentFrom,
        contentTo: activeCell.resolvedCell.contentTo,
    };
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

// A drag parks the main caret in the cell under the pointer; syncing the open cell from it
// would overwrite the cell's text with the drag's own selection.
function shouldSyncMainToNested(
    facts: TableRuntimeFacts
): facts is TableRuntimeFacts & { activeCell: ResolvedActiveCellFacts } {
    return (
        facts.nestedEditorOpen &&
        !facts.isSync &&
        !facts.cellDragInProgress &&
        facts.activeCell.status === 'resolved' &&
        (facts.docChanged || (facts.selectionChanged && facts.activeCellIdentityUnchanged))
    );
}

function requiresCellReposition(facts: TableRuntimeFacts): boolean {
    if (!facts.docChanged || facts.isSync || facts.isCellSelectionTransition || facts.effectiveRawMode) {
        return false;
    }

    return facts.activeCellBefore === 'resolved' ? facts.activeHostInvalidated : facts.isUndoRedoInsideTable;
}

// A drag parks the main caret in the cell under the pointer, so the active cell it left open
// always reads as "selection left the table". Closing it would reflow the table mid-gesture;
// the drag clears the active cell itself on release.
function shouldClearActiveCellWhenSelectionLeavesTable(facts: TableRuntimeFacts): boolean {
    return (
        facts.selectionChanged &&
        !facts.isSync &&
        !facts.isCellSelectionTransition &&
        !facts.cellDragInProgress &&
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
            entryMode: 'adopt',
        };
    }

    return {
        clearIfOutside: true,
        ensureCursorVisibleIfNotActivated: false,
        entryMode: 'enter',
    };
}
