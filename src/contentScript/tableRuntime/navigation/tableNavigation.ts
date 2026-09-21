import { EditorView } from '@codemirror/view';
import { getResolvedActiveCell, type ResolvedActiveCell } from '../activeCell/resolvedActiveCell';
import { resolveClampedCell } from '../activeCell/activeCellFactory';
import { runStructuralCommand } from '../operations/structuralOperations';
import type { InitialCursorPos } from '../../shared/cursorPlacement';
import { isSameCellCoords } from '../../tableModel/types';
import { getTableGridBounds } from '../../tableModel/tableContext';
import { requestOpenCell, shouldSuppressNavigationKeys } from '../openCellRequest';
import { resolveNavigationTarget, type NavigationDirection } from './navigationTarget';
import { clearActiveCellEffect } from '../../tableState/activeCellState';
import { exitTableToAdjacentLine } from './tableExit';

export interface NavigateCellOptions {
    initialCursorPos?: InitialCursorPos;
    allowRowCreation?: boolean;
    exitTableAtBoundary?: boolean;
}

function exitTable(view: EditorView, resolvedActiveCell: ResolvedActiveCell, direction: NavigationDirection): void {
    const exitsBefore = direction === 'previous' || direction === 'up';
    exitTableToAdjacentLine(view, resolvedActiveCell.ctx, exitsBefore ? 'before' : 'after', [
        clearActiveCellEffect.of(undefined),
    ]);
}

export function navigateCell(
    view: EditorView,
    direction: NavigationDirection,
    options: NavigateCellOptions = {}
): boolean {
    // Prevent race conditions from rapid key-holding
    if (shouldSuppressNavigationKeys(view.state)) {
        return true; // Swallow keypress, navigation already in progress
    }

    const resolvedActiveCell = getResolvedActiveCell(view.state);
    if (!resolvedActiveCell) {
        return false;
    }

    const target = resolveNavigationTarget({
        from: resolvedActiveCell.activeCell,
        bounds: getTableGridBounds(resolvedActiveCell.ctx),
        direction,
        allowRowCreation: options.allowRowCreation === true,
    });

    if (target.kind === 'blocked') {
        if (options.exitTableAtBoundary) {
            exitTable(view, resolvedActiveCell, direction);
        }
        return true;
    }

    if (target.kind === 'newRow') {
        runStructuralCommand(view, resolvedActiveCell, { type: 'insertRowAfter', targetCol: target.targetCol });
        return true;
    }

    // Wrap and new-row keep header-width geometry. The cell that actually opens is
    // clamped onto a source-backed range so a ragged row cannot fail to resolve.
    // Same-row Tab into a missing column therefore stays put; skipping holes would
    // be a different wrap rule.
    const nextResolvedCell = resolveClampedCell({ ctx: resolvedActiveCell.ctx, target: target.coords });
    if (isSameCellCoords(nextResolvedCell.activeCell, resolvedActiveCell.activeCell)) {
        return true;
    }

    requestOpenCell(view, {
        resolvedCell: nextResolvedCell,
        initialCursorPos: options.initialCursorPos,
        suppressKeys: true,
    });

    return true;
}
