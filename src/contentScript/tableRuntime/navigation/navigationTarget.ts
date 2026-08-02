/**
 * Pure keyboard-navigation geometry: given the active cell, the table's grid bounds and a
 * direction, decide where the keypress lands.
 *
 * Kept free of EditorView/EditorState so the branching that keyboard navigation keeps
 * accumulating stays directly unit-testable; `navigateCell` owns the editor-facing effects.
 */
import { fromUnifiedRow, toUnifiedRow } from '../../tableState/cellSelectionState';
import type { CellCoords, TableGridBounds } from '../../tableModel/types';

export type NavigationDirection = 'next' | 'previous' | 'up' | 'down';

/**
 * - `blocked`: the keypress is consumed but nothing moves (walked off a table edge).
 * - `cell`: activate `coords`.
 * - `newRow`: append a row and land in `targetCol`.
 */
export type NavigationTarget =
    { kind: 'blocked' } | { kind: 'cell'; coords: CellCoords } | { kind: 'newRow'; targetCol: number };

interface UnifiedPosition {
    row: number;
    col: number;
}

/**
 * Moves one step in unified coordinates. `next`/`previous` wrap across row boundaries;
 * `up`/`down` keep the column. The result may sit outside the table - callers handle bounds.
 */
function stepUnifiedPosition(
    position: UnifiedPosition,
    direction: NavigationDirection,
    totalCols: number
): UnifiedPosition {
    switch (direction) {
        case 'next': {
            const col = position.col + 1;
            return col >= totalCols ? { row: position.row + 1, col: 0 } : { row: position.row, col };
        }
        case 'previous': {
            const col = position.col - 1;
            return col < 0 ? { row: position.row - 1, col: totalCols - 1 } : { row: position.row, col };
        }
        case 'up':
            return { row: position.row - 1, col: position.col };
        case 'down':
            return { row: position.row + 1, col: position.col };
    }
}

export function resolveNavigationTarget(params: {
    from: CellCoords;
    bounds: TableGridBounds;
    direction: NavigationDirection;
    allowRowCreation: boolean;
}): NavigationTarget {
    const { from, bounds, direction, allowRowCreation } = params;

    const next = stepUnifiedPosition({ row: toUnifiedRow(from), col: from.col }, direction, bounds.totalCols);

    // Walked off the top: stop at the table start rather than wrapping around.
    if (next.row < 0) {
        return { kind: 'blocked' };
    }

    if (next.row >= bounds.totalRows) {
        if (!allowRowCreation) {
            return { kind: 'blocked' };
        }
        // Tab ('next') starts the new row at its first column; Enter/down keeps the column.
        return { kind: 'newRow', targetCol: direction === 'next' ? 0 : from.col };
    }

    return { kind: 'cell', coords: fromUnifiedRow(next.row, next.col) };
}
