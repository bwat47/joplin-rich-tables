import type { EditorView } from '@codemirror/view';
import { MarkdownTable, type SerializedTable, type TableAlignment } from '../../tableModel/MarkdownTable';
import { createFirstActiveCellForTable } from '../activeCell/activeCellFactory';
import { prepareOpenCellRequestAttachment } from '../openCellRequest';
import { buildRootTableInsertRewrite } from './rootTableInsertRewrite';

const DEFAULT_INSERTED_TABLE_COLUMNS = 2;
const DEFAULT_INSERTED_TABLE_BODY_ROWS = 1;
const DEFAULT_INSERTED_TABLE_ALIGNMENT: TableAlignment = null;
const EMPTY_CELL = '';
const DEFAULT_INSERTED_TABLE = buildDefaultInsertedTable();

/** Builds the empty table used by the insert command directly from known parts, without parsing. */
function buildDefaultInsertedTable(): SerializedTable {
    const emptyRow = (): string[] => new Array<string>(DEFAULT_INSERTED_TABLE_COLUMNS).fill(EMPTY_CELL);
    return MarkdownTable.fromParts({
        headerCells: emptyRow(),
        alignments: new Array<TableAlignment>(DEFAULT_INSERTED_TABLE_COLUMNS).fill(DEFAULT_INSERTED_TABLE_ALIGNMENT),
        bodyRows: Array.from({ length: DEFAULT_INSERTED_TABLE_BODY_ROWS }, emptyRow),
    }).serializeWithOffsets();
}

export function insertTableAndActivate(view: EditorView): boolean {
    const cursorPos = view.state.selection.main.head;
    const rewrite = buildRootTableInsertRewrite(view.state, cursorPos, cursorPos, DEFAULT_INSERTED_TABLE.text);
    const nextActiveCell = createFirstActiveCellForTable({
        tableFrom: rewrite.tableFrom,
        serialized: DEFAULT_INSERTED_TABLE,
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
