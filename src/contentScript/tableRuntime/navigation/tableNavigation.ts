import { EditorView } from '@codemirror/view';
import {
    getResolvedActiveCell,
    resolveCellWithinResolvedTable,
    type ResolvedActiveCell,
} from '../activeCell/resolvedActiveCell';
import { insertRowAtBottom } from '../operations/structuralOperations';
import type { InitialCursorPos } from '../../shared/cursorPlacement';
import { getTableGridBounds } from '../../tableModel/tableContext';
import { requestOpenCell, shouldSuppressNavigationKeys } from '../openCellRequest';
import { resolveNavigationTarget, type NavigationDirection } from './navigationTarget';
import { clearActiveCellEffect } from '../../tableState/activeCellState';
import { focusMainEditorWithoutScroll } from '../../shared/mainEditorFocus';

export interface NavigateCellOptions {
    initialCursorPos?: InitialCursorPos;
    allowRowCreation?: boolean;
    exitTableAtBoundary?: boolean;
}

function exitTable(view: EditorView, resolvedActiveCell: ResolvedActiveCell, direction: 'up' | 'down'): void {
    const { from, to } = resolvedActiveCell.ctx;
    const exitPos = direction === 'up' ? from - 1 : to + 1;
    if (exitPos < 0 || exitPos > view.state.doc.length) {
        return;
    }

    view.dispatch({
        selection: { anchor: exitPos },
        effects: clearActiveCellEffect.of(undefined),
        scrollIntoView: true,
    });
    focusMainEditorWithoutScroll(view);
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
        if (options.exitTableAtBoundary && (direction === 'up' || direction === 'down')) {
            exitTable(view, resolvedActiveCell, direction);
        }
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
