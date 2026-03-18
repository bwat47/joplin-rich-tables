import { describe, expect, it, jest } from '@jest/globals';
import type { EditorState, TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { insertTableAndActivate } from '../tableRuntime/tableOperations';
import { createMarkdownState } from './testMarkdownState';

const activateTableCellMock = jest.fn();

jest.mock('../tableRuntime/cellActivation', () => ({
    activateTableCell: (...args: unknown[]) => activateTableCellMock(...args),
}));

const DEFAULT_INSERTED_TABLE_MARKDOWN = ['|  |  |', '| --- | --- |', '|  |  |'].join('\n');

function createMockView(doc: string, cursorPos: number): EditorView & { state: EditorState } {
    const view = {
        state: createMarkdownState(doc).update({ selection: { anchor: cursorPos } }).state,
        dispatch(spec: TransactionSpec) {
            this.state = this.state.update(spec).state;
        },
    };

    return view as EditorView & { state: EditorState };
}

describe('insertTableAndActivate', () => {
    it('reuses isolated block insertion behavior on a whitespace-only line', () => {
        activateTableCellMock.mockReset();

        const doc = ['before', '', 'after'].join('\n');
        const view = createMockView(doc, 'before\n'.length);

        insertTableAndActivate(view);

        expect(view.state.doc.toString()).toBe(
            ['before', '', ...DEFAULT_INSERTED_TABLE_MARKDOWN.split('\n'), '', 'after'].join('\n')
        );
        expect(view.state.selection.main.head).toBe(10);
        expect(activateTableCellMock).toHaveBeenCalledWith(view, 8, {
            section: 'header',
            row: 0,
            col: 0,
        });
    });

    it('falls back to the legacy direct insert path mid-line', () => {
        activateTableCellMock.mockReset();

        const doc = 'before after';
        const cursorPos = doc.indexOf(' ');
        const view = createMockView(doc, cursorPos);

        insertTableAndActivate(view);

        expect(view.state.doc.toString()).toBe(`before\n${DEFAULT_INSERTED_TABLE_MARKDOWN}\n after`);
        expect(view.state.selection.main.head).toBe(cursorPos + 3);
        expect(activateTableCellMock).toHaveBeenCalledWith(view, cursorPos + 1, {
            section: 'header',
            row: 0,
            col: 0,
        });
    });

    it('keeps empty-document insertion aligned with root paste behavior', () => {
        activateTableCellMock.mockReset();

        const view = createMockView('', 0);

        insertTableAndActivate(view);

        expect(view.state.doc.toString()).toBe(`\n${DEFAULT_INSERTED_TABLE_MARKDOWN}\n`);
        expect(view.state.selection.main.head).toBe(3);
        expect(activateTableCellMock).toHaveBeenCalledWith(view, 1, {
            section: 'header',
            row: 0,
            col: 0,
        });
    });
});
