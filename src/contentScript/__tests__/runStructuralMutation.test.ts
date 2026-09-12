import { vi } from 'vitest';
import { getResolvedActiveCell, type ResolvedActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import { runStructuralMutationAndReopen } from '../tableRuntime/operations/runStructuralMutation';
import type { EditorView } from '@codemirror/view';
import type { ActiveCell } from '../tableState/activeCellState';
import { createInteractiveTableHarness } from './interactiveTableTestHarness';

const TABLE_LINES = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'];
const DOC = TABLE_LINES.join('\n');

function harnessWithResolvedCell(activeCell: ActiveCell): { view: EditorView; resolvedCell: ResolvedActiveCell } {
    const { view } = createInteractiveTableHarness({ doc: DOC, activeCell });
    const resolvedCell = getResolvedActiveCell(view.state);

    if (!resolvedCell) {
        throw new Error('Expected a resolved active cell');
    }

    return { view, resolvedCell };
}

describe('runStructuralMutationAndReopen', () => {
    it('rewrites the table and hands control back through afterDispatch', () => {
        const { view, resolvedCell } = harnessWithResolvedCell({ tableFrom: 0, section: 'body', row: 0, col: 0 });
        const afterDispatch = vi.fn();

        const result = runStructuralMutationAndReopen({
            view,
            resolvedCell,
            command: { type: 'insertRowAfter', targetCol: 1 },
            afterDispatch,
        });

        expect(result).toBe(true);
        expect(view.state.doc.toString()).toBe([...TABLE_LINES, '|  |  |'].join('\n'));
        expect(afterDispatch).toHaveBeenCalledTimes(1);
    });

    /**
     * Callers use `afterDispatch` to hand focus back to the editor, so a command that changes
     * nothing must not run it - otherwise a refused mutation still steals focus from the cell
     * the user is editing.
     */
    it('reports failure and skips afterDispatch when the command leaves the table unchanged', () => {
        const { view, resolvedCell } = harnessWithResolvedCell({ tableFrom: 0, section: 'header', row: 0, col: 0 });
        const afterDispatch = vi.fn();

        const result = runStructuralMutationAndReopen({
            view,
            resolvedCell,
            command: { type: 'moveRowUp' },
            afterDispatch,
        });

        expect(result).toBe(false);
        expect(view.state.doc.toString()).toBe(DOC);
        expect(afterDispatch).not.toHaveBeenCalled();
    });
});
