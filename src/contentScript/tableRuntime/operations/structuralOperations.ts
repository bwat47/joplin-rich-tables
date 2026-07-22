import { EditorView } from '@codemirror/view';
import type { StructuralTableCommand } from '../../tableModel/structuralCommandSemantics';
import type { ResolvedActiveCell } from '../activeCell/resolvedActiveCell';
import { focusMainEditorWithoutScroll } from '../../shared/mainEditorFocus';
import { buildRootTableInsertRewrite } from './rootTableInsertRewrite';
import { runStructuralMutationAndReopen, type StructuralReopenOptions } from './runStructuralMutation';
import { activateInsertedTableEffect } from '../../tableState/insertedTableActivation';

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
    const rewrite = buildRootTableInsertRewrite(view.state, cursorPos, cursorPos, DEFAULT_INSERTED_TABLE_MARKDOWN);

    view.dispatch({
        changes: rewrite.changes,
        selection: { anchor: rewrite.tableFrom + DEFAULT_INSERTED_TABLE_SELECTION_OFFSET },
        effects: [
            activateInsertedTableEffect.of({
                tableFrom: rewrite.tableFrom,
                target: { section: 'header', row: 0, col: 0 },
            }),
        ],
        scrollIntoView: false,
    });

    return true;
}
