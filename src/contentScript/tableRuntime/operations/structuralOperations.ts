import { EditorView } from '@codemirror/view';
import { MarkdownTable, type SerializedTable, type TableAlignment } from '../../tableModel/MarkdownTable';
import type { StructuralTableCommand } from '../../tableModel/structuralCommandSemantics';
import type { ResolvedActiveCell } from '../activeCell/resolvedActiveCell';
import { createActiveCellForTable } from '../activeCell/activeCellFactory';
import { prepareOpenCellRequestAttachment } from '../openCellRequest';
import { buildRootTableInsertRewrite } from './rootTableInsertRewrite';
import { runStructuralMutationAndReopen, type StructuralReopenOptions } from './runStructuralMutation';

export type RowInsertOpenOptions = StructuralReopenOptions;

const DEFAULT_INSERTED_TABLE_COLUMNS = 2;
const DEFAULT_INSERTED_TABLE_BODY_ROWS = 1;
const DEFAULT_INSERTED_TABLE_ALIGNMENT: TableAlignment = null;
const EMPTY_CELL = '';
const DEFAULT_INSERTED_TABLE = buildDefaultInsertedTable();
const INSERTED_TABLE_HEADER_CELL = { section: 'header', row: 0, col: 0 } as const;

/** Builds the empty table used by the insert command directly from known parts, without parsing. */
function buildDefaultInsertedTable(): SerializedTable {
    const emptyRow = (): string[] => new Array<string>(DEFAULT_INSERTED_TABLE_COLUMNS).fill(EMPTY_CELL);
    return MarkdownTable.fromParts({
        headerCells: emptyRow(),
        alignments: new Array<TableAlignment>(DEFAULT_INSERTED_TABLE_COLUMNS).fill(DEFAULT_INSERTED_TABLE_ALIGNMENT),
        bodyRows: Array.from({ length: DEFAULT_INSERTED_TABLE_BODY_ROWS }, emptyRow),
    }).serializeWithOffsets();
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
