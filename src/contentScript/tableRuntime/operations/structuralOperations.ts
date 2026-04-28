import { EditorView } from '@codemirror/view';
import { clearActiveCellEffect } from '../../tableState/activeCellState';
import { rebuildTableWidgetsEffect } from '../../tableState/tableWidgetEffects';
import type { TableAlignment } from '../../tableModel/MarkdownTable';
import type { StructuralTableCommand } from '../../tableModel/structuralCommandSemantics';
import type { ResolvedActiveCell } from '../activeCell/resolvedActiveCell';
import { activateTableCell } from '../activeCell/cellActivation';
import { focusMainEditorWithoutScroll } from '../../shared/mainEditorFocus';
import { buildIsolatedRootTableInsertRewrite } from './rootTableInsertRewrite';
import { runStructuralMutationAndReopen, type StructuralReopenOptions } from './runStructuralMutation';

export type CommandColumnAlignment = TableAlignment;
export type RowInsertOpenOptions = StructuralReopenOptions;

const DEFAULT_INSERTED_TABLE_MARKDOWN = ['|  |  |', '| --- | --- |', '|  |  |'].join('\n');
const DEFAULT_INSERTED_TABLE_SELECTION_OFFSET = 2;

export function getDefaultStructuralReopenOptions(view: EditorView): StructuralReopenOptions {
    return {
        afterDispatch: () => focusMainEditorWithoutScroll(view),
    };
}

export function getDefaultRowInsertOpenOptions(view: EditorView): RowInsertOpenOptions {
    return {
        ...getDefaultStructuralReopenOptions(view),
        initialCursorPos: 'start',
    };
}

function createReopeningStructuralOperation(command: StructuralTableCommand) {
    return (view: EditorView, resolvedCell: ResolvedActiveCell, options?: StructuralReopenOptions): boolean =>
        runStructuralMutationAndReopen({
            view,
            resolvedCell,
            command,
            ...getDefaultStructuralReopenOptions(view),
            ...options,
        });
}

function createRowInsertOperation(command: StructuralTableCommand) {
    return (view: EditorView, resolvedCell: ResolvedActiveCell, options?: RowInsertOpenOptions): boolean =>
        runStructuralMutationAndReopen({
            view,
            resolvedCell,
            command,
            ...getDefaultRowInsertOpenOptions(view),
            ...options,
        });
}

export const insertRowAbove = createRowInsertOperation({ type: 'insertRowBefore' });

export const insertRowBelow = createRowInsertOperation({ type: 'insertRowAfter' });

export const insertColumnLeft = createReopeningStructuralOperation({ type: 'insertColumnBefore' });

export const insertColumnRight = createReopeningStructuralOperation({ type: 'insertColumnAfter' });

export const deleteRow = createReopeningStructuralOperation({ type: 'deleteRow' });

export const deleteColumn = createReopeningStructuralOperation({ type: 'deleteColumn' });

export const moveRowUp = createReopeningStructuralOperation({ type: 'moveRowUp' });

export const moveRowDown = createReopeningStructuralOperation({ type: 'moveRowDown' });

export const moveColumnLeft = createReopeningStructuralOperation({ type: 'moveColumnLeft' });

export const moveColumnRight = createReopeningStructuralOperation({ type: 'moveColumnRight' });

export const clearTable = createReopeningStructuralOperation({ type: 'clearTable' });

export const clearRow = createReopeningStructuralOperation({ type: 'clearRow' });

export const clearColumn = createReopeningStructuralOperation({ type: 'clearColumn' });

export function deleteTable(view: EditorView, resolvedCell: ResolvedActiveCell): boolean {
    view.dispatch({
        changes: { from: resolvedCell.tableFrom, to: resolvedCell.tableTo, insert: '' },
        effects: [
            clearActiveCellEffect.of(undefined),
            rebuildTableWidgetsEffect.of({ tableFrom: resolvedCell.tableFrom }),
        ],
    });

    focusMainEditorWithoutScroll(view);

    return true;
}

export function updateAlignment(
    view: EditorView,
    resolvedCell: ResolvedActiveCell,
    align: CommandColumnAlignment,
    options?: StructuralReopenOptions
): boolean {
    return runStructuralMutationAndReopen({
        view,
        resolvedCell,
        command: { type: 'alignColumn', alignment: align },
        ...getDefaultStructuralReopenOptions(view),
        ...options,
    });
}

export function insertRowAtBottom(
    view: EditorView,
    resolvedCell: ResolvedActiveCell,
    targetCol: number,
    options?: RowInsertOpenOptions
): boolean {
    return runStructuralMutationAndReopen({
        view,
        resolvedCell,
        command: { type: 'insertRowAfter', targetCol },
        ...getDefaultRowInsertOpenOptions(view),
        ...options,
    });
}

export function insertTableAndActivate(view: EditorView): boolean {
    const cursorPos = view.state.selection.main.head;
    const rewrite = buildIsolatedRootTableInsertRewrite(
        view.state,
        cursorPos,
        cursorPos,
        DEFAULT_INSERTED_TABLE_MARKDOWN
    ) ?? {
        changes: {
            from: cursorPos,
            to: cursorPos,
            insert: `\n${DEFAULT_INSERTED_TABLE_MARKDOWN}\n`,
        },
        tableFrom: cursorPos + 1,
    };

    view.dispatch({
        changes: rewrite.changes,
        selection: { anchor: rewrite.tableFrom + DEFAULT_INSERTED_TABLE_SELECTION_OFFSET },
    });

    activateTableCell(view, rewrite.tableFrom, { section: 'header', row: 0, col: 0 });
    return true;
}
