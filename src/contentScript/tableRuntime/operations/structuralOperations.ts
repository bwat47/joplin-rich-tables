import { EditorView } from '@codemirror/view';
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

export function updateAlignment(
    view: EditorView,
    resolvedCell: ResolvedActiveCell,
    align: CommandColumnAlignment,
    options?: StructuralReopenOptions
): boolean {
    return runStructuralCommand(view, resolvedCell, { type: 'alignColumn', alignment: align }, options);
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
