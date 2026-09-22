import type { EditorView } from '@codemirror/view';
import { clearActiveCellEffect } from '../../tableState/activeCellState';
import { structuralTableEditEffect } from '../../tableState/structuralTableEditEffect';
import { applyStructuralTableCommand, type StructuralTableCommand } from '../../tableModel/structuralCommandSemantics';
import { prepareOpenCellRequestAttachment } from '../openCellRequest';
import { createActiveCellForTable } from '../activeCell/activeCellFactory';
import type { InitialCursorPos } from '../../shared/cursorPlacement';
import type { ResolvedActiveCell } from '../activeCell/resolvedActiveCell';
import { isSameCellCoords } from '../../tableModel/types';

const ROW_INSERT_CURSOR_POS: InitialCursorPos = 'start';

/**
 * Row inserts are the only commands that always reopen into a brand-new empty cell, so they
 * are the only ones that pin the caret rather than mirror the main selection.
 *
 * Column inserts are deliberately absent: `insertColumnBefore` reopens the existing cell the
 * caret came from, and while `insertColumnAfter` does reopen an empty cell, an empty cell
 * collapses the mirrored selection onto its start anyway, so an override would change nothing.
 */
function commandInsertsRow(command: StructuralTableCommand): boolean {
    return command.type === 'insertRowBefore' || command.type === 'insertRowAfter';
}

interface PreparedTableMutation {
    kind: 'table';
    tableFrom: number;
    tableTo: number;
    newText: string;
    hasDocumentChange: boolean;
    nextActiveCell: NonNullable<ReturnType<typeof createActiveCellForTable>>;
}

interface PreparedTableDeletion {
    kind: 'deleteTable';
    tableFrom: number;
    tableTo: number;
}

type PreparedStructuralMutation = PreparedTableMutation | PreparedTableDeletion;

function prepareStructuralMutation(
    resolvedCell: ResolvedActiveCell,
    command: StructuralTableCommand
): PreparedStructuralMutation | null {
    const cell = resolvedCell.activeCell;
    const { ctx } = resolvedCell;
    const { from: tableFrom, to: tableTo } = ctx;
    const text = ctx.text;

    const mutationResult = applyStructuralTableCommand(ctx.table, cell, command);
    if (mutationResult.kind === 'deleteTable') {
        return {
            kind: 'deleteTable',
            tableFrom,
            tableTo,
        };
    }

    const newTableData = mutationResult.table;
    if (newTableData === ctx.table) {
        return null;
    }
    const serialized = newTableData.serializeWithOffsets();

    const nextActiveCell = createActiveCellForTable({
        tableFrom,
        serialized,
        target: mutationResult.targetCell,
    });
    if (!nextActiveCell) {
        return null;
    }
    const hasDocumentChange = serialized.text !== text;
    if (!hasDocumentChange && isSameCellCoords(nextActiveCell.activeCell, cell)) {
        return null;
    }

    return {
        kind: 'table',
        tableFrom,
        tableTo,
        newText: serialized.text,
        hasDocumentChange,
        nextActiveCell,
    };
}

export function runStructuralCommand(
    view: EditorView,
    resolvedCell: ResolvedActiveCell,
    command: StructuralTableCommand
): boolean {
    const prepared = prepareStructuralMutation(resolvedCell, command);
    if (!prepared) {
        return false;
    }

    if (prepared.kind === 'deleteTable') {
        view.dispatch({
            changes: { from: prepared.tableFrom, to: prepared.tableTo, insert: '' },
            effects: [clearActiveCellEffect.of(null), structuralTableEditEffect.of(null)],
        });
        view.focus();

        return true;
    }

    const initialCursorPos = commandInsertsRow(command) ? ROW_INSERT_CURSOR_POS : undefined;
    const openRequest = prepareOpenCellRequestAttachment({
        activeCell: prepared.nextActiveCell.activeCell,
        selectionAnchor: prepared.nextActiveCell.selectionAnchor,
        initialCursorPos,
        // The rewrite lands under a caret the main editor still owns until the cell editor
        // mounts, so navigation keys stay suppressed until the reopen settles.
        suppressKeys: true,
    });

    view.dispatch({
        ...(prepared.hasDocumentChange
            ? {
                  changes: {
                      from: prepared.tableFrom,
                      to: prepared.tableTo,
                      insert: prepared.newText,
                  },
              }
            : {}),
        ...openRequest,
        effects: [...openRequest.effects, structuralTableEditEffect.of(null)],
    });
    view.focus();

    return true;
}
