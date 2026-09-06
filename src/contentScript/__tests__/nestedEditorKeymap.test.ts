import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNestedEditorKeymap } from '../nestedEditor/domHandlers';
import { activeCellField, getActiveCell, setActiveCellEffect, type ActiveCell } from '../tableState/activeCellState';
import { createMarkdownState } from './testMarkdownState';

const TABLE = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |', '| b1 | b2 |'].join('\n');
const PREFIX = 'above\n\n';
const DOC = `${PREFIX}${TABLE}\n\nbelow`;
const TABLE_FROM = PREFIX.length;
const TABLE_TO = TABLE_FROM + TABLE.length;
const mountedViews: EditorView[] = [];

function mountMainView(activeCell: ActiveCell): EditorView {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
        parent,
        state: createMarkdownState(DOC, [activeCellField]),
    });
    view.dispatch({ effects: setActiveCellEffect.of(activeCell) });
    mountedViews.push(view);
    return view;
}

function mountNestedView(
    mainView: EditorView,
    selection: number
): { view: EditorView; sync: ReturnType<typeof vi.fn> } {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const sync = vi.fn();
    const view = new EditorView({
        parent,
        doc: 'cell',
        selection: { anchor: selection },
        extensions: [
            createNestedEditorKeymap(mainView, {
                getSelectionBounds: (nestedView) => ({ from: 0, to: nestedView.state.doc.length }),
                closeEditor: vi.fn(),
                syncPendingChangesToRoot: sync,
            }),
        ],
    });
    view.contentDOM.focus();
    mountedViews.push(view);
    return { view, sync };
}

function pressKey(view: EditorView, key: string): void {
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

afterEach(() => {
    while (mountedViews.length > 0) {
        mountedViews.pop()?.destroy();
    }
    document.body.replaceChildren();
});

describe('nested editor horizontal table exit', () => {
    it('exits above the table on ArrowLeft from the first cell start', () => {
        const mainView = mountMainView({ tableFrom: TABLE_FROM, section: 'header', row: 0, col: 0 });
        const nested = mountNestedView(mainView, 0);

        pressKey(nested.view, 'ArrowLeft');

        expect(nested.sync).toHaveBeenCalledOnce();
        expect(getActiveCell(mainView.state)).toBeNull();
        expect(mainView.state.selection.main.head).toBe(TABLE_FROM - 1);
    });

    it('exits below the table on ArrowRight from the final cell end', () => {
        const mainView = mountMainView({ tableFrom: TABLE_FROM, section: 'body', row: 1, col: 1 });
        const nested = mountNestedView(mainView, 'cell'.length);

        pressKey(nested.view, 'ArrowRight');

        expect(nested.sync).toHaveBeenCalledOnce();
        expect(getActiveCell(mainView.state)).toBeNull();
        expect(mainView.state.selection.main.head).toBe(TABLE_TO + 1);
    });
});
