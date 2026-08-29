import type { EditorState } from '@codemirror/state';
import { getActiveCell } from '../tableState/activeCellState';
import { getCellSelection } from '../tableState/cellSelectionState';
import { isEffectiveRawMode } from '../tableState/sourceMode';
import { getPendingOpenCellRequest } from './openCellRequest';

/**
 * True when the main editor holds a plain caret over rendered tables.
 *
 * Raw mode, a cell selection, an active cell, and an in-flight entry request each hand table
 * editing to another owner, so runtime policies acting on a table's behalf must stand down.
 */
export function hasPlainRenderedTableCaret(state: EditorState): boolean {
    return (
        !isEffectiveRawMode(state) &&
        !getCellSelection(state) &&
        !getActiveCell(state) &&
        !getPendingOpenCellRequest(state)
    );
}
