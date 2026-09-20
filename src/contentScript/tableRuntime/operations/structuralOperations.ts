import { EditorView } from '@codemirror/view';
import { MarkdownTable, type SerializedTable } from '../../tableModel/MarkdownTable';
import type { StructuralTableCommand } from '../../tableModel/structuralCommandSemantics';
import type { ResolvedActiveCell } from '../activeCell/resolvedActiveCell';
import { createActiveCellForTable } from '../activeCell/activeCellFactory';
import { prepareOpenCellRequestAttachment } from '../openCellRequest';
import { buildRootTableInsertRewrite } from './rootTableInsertRewrite';
import { runStructuralMutationAndReopen, type StructuralReopenOptions } from './runStructuralMutation';

export type RowInsertOpenOptions = StructuralReopenOptions;

const DEFAULT_INSERTED_TABLE_MARKDOWN = ['|  |  |', '| --- | --- |', '|  |  |'].join('\n');
const DEFAULT_INSERTED_TABLE = serializeDefaultInsertedTable();
const INSERTED_TABLE_HEADER_CELL = { section: 'header', row: 0, col: 0 } as const;

function serializeDefaultInsertedTable(): SerializedTable {
    const table = MarkdownTable.parse(DEFAULT_INSERTED_TABLE_MARKDOWN);
    if (!table) {
        throw new Error('Default inserted table markdown must parse as a table');
    }
    return table.serializeWithOffsets();
}

export function getDefaultStructuralReopenOptions(view: EditorView): StructuralReopenOptions {
    return {
        afterDispatch: () => view.focus(),
    };
}

export function getDefaultRowInsertOpenOptions(view: EditorView): RowInsertOpenOptions {
    return {
        ...getDefaultStructuralReopenOptions(view),
        initialCursorPos: 'start',
    };
}

function commandUsesRowInsertDefaults(command: StructuralTableCommand): boolean {
    return command.type === 'insertRowBefore' || command.type === 'insertRowAfter';
}

export function runStructuralCommand(
    view: EditorView,
    resolvedCell: ResolvedActiveCell,
    command: StructuralTableCommand,
    options?: StructuralReopenOptions
): boolean {
    const defaults = commandUsesRowInsertDefaults(command)
        ? getDefaultRowInsertOpenOptions(view)
        : getDefaultStructuralReopenOptions(view);

    return runStructuralMutationAndReopen({
        view,
        resolvedCell,
        command,
        ...defaults,
        ...options,
    });
}

export function insertRowAtBottom(
    view: EditorView,
    resolvedCell: ResolvedActiveCell,
    targetCol: number,
    options?: RowInsertOpenOptions
): boolean {
    return runStructuralCommand(view, resolvedCell, { type: 'insertRowAfter', targetCol }, options);
}

export function insertTableAndActivate(view: EditorView): boolean {
    const cursorPos = view.state.selection.main.head;
    const rewrite = buildRootTableInsertRewrite(view.state, cursorPos, cursorPos, DEFAULT_INSERTED_TABLE.text);
    const nextActiveCell = createActiveCellForTable({
        tableFrom: rewrite.tableFrom,
        serialized: DEFAULT_INSERTED_TABLE,
        target: INSERTED_TABLE_HEADER_CELL,
    });
    if (!nextActiveCell) {
        return false;
    }

    const openRequest = prepareOpenCellRequestAttachment({
        activeCell: nextActiveCell.activeCell,
        selectionAnchor: nextActiveCell.selectionAnchor,
        suppressKeys: true,
    });

    view.dispatch({
        changes: rewrite.changes,
        ...openRequest,
        scrollIntoView: false,
    });

    return true;
}
