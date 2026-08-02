import { EditorView } from '@codemirror/view';
import { getResolvedActiveCell, resolveCellWithinResolvedTable } from '../activeCell/resolvedActiveCell';
import { insertRowAtBottom } from '../operations/structuralOperations';
import type { InitialCursorPos } from '../../shared/cursorPlacement';
import { getTableGridBounds } from '../../tableModel/tableContext';
import { requestOpenCell, shouldSuppressNavigationKeys } from '../openCellRequest';
import { resolveNavigationTarget, type NavigationDirection } from './navigationTarget';

export function navigateCell(
    view: EditorView,
    direction: NavigationDirection,
    options: { initialCursorPos?: InitialCursorPos; allowRowCreation?: boolean } = {}
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
        return true;
    }

    if (target.kind === 'newRow') {
        insertRowAtBottom(view, resolvedActiveCell, target.targetCol, { suppressKeys: true });
        return true;
    }

    const nextResolvedCell = resolveCellWithinResolvedTable(resolvedActiveCell, target.coords);
    if (!nextResolvedCell) {
        return false;
    }

    requestOpenCell(view, {
        target: { resolvedCell: nextResolvedCell },
        normalizeIfNeeded: true,
        initialCursorPos: options.initialCursorPos,
        suppressKeys: true,
    });

    return true;
}
