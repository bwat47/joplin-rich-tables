import { ensureSyntaxTree } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    cellSelectionField,
    cellSelectionTransitionAnnotation,
    getCellSelection,
    setCellSelectionEffect,
} from '../tableState/cellSelectionState';
import { cellSelectionScopeGuard } from '../tableRuntime/selection/cellSelectionScopeGuard';
import { getTableContextAtPos, tableContextField } from '../tableState/tableContextField';

const TABLE = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
const PREFIX = 'above';
const DOC = `${PREFIX}\n\n${TABLE}\n\nbelow`;
const TABLE_FROM = PREFIX.length + 2;
const TABLE_TO = TABLE_FROM + TABLE.length;
const FILLER = 'lorem ipsum dolor sit amet '.repeat(40);
const LONG_TABLE_DOCUMENT = Array.from({ length: 5 }, () => `${FILLER}\n\n${TABLE}`).join('\n\n');
const CLOCK_ADVANCE_MS = 2_000;
const COMPLETE_PARSE_TIMEOUT_MS = 1_000;

const mountedViews: EditorView[] = [];

function mountView(): EditorView {
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const view = new EditorView({
        parent,
        doc: DOC,
        extensions: [markdown({ extensions: [GFM] }), tableContextField, cellSelectionField, cellSelectionScopeGuard],
    });
    mountedViews.push(view);

    return view;
}

/** The guard defers its clear to an animation frame; jsdom runs those on a timer. */
function flushFrames(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 32));
}

function selectTable(view: EditorView): void {
    view.dispatch({
        selection: { anchor: TABLE_FROM + 1 },
        effects: setCellSelectionEffect.of({
            tableFrom: TABLE_FROM,
            anchor: { section: 'header', row: 0, col: 0 },
            focus: { section: 'body', row: 0, col: 1 },
        }),
        annotations: cellSelectionTransitionAnnotation.of(true),
    });
}

afterEach(() => {
    while (mountedViews.length > 0) {
        mountedViews.pop()?.destroy();
    }
    document.body.replaceChildren();
});

describe('cellSelectionScopeGuard', () => {
    it('drops the selection when a main-editor command moves the caret out of the table', async () => {
        const view = mountView();
        selectTable(view);
        expect(getCellSelection(view.state)).not.toBeNull();

        // Stands in for any unhandled movement command, e.g. Ctrl+Home.
        view.dispatch({ selection: { anchor: 0 } });
        await flushFrames();

        expect(getCellSelection(view.state)).toBeNull();
    });

    it('keeps the selection while the caret stays inside the table', async () => {
        const view = mountView();
        selectTable(view);

        view.dispatch({ selection: { anchor: TABLE_TO - 1 } });
        await flushFrames();

        expect(getCellSelection(view.state)).not.toBeNull();
    });

    it('keeps the selection through the transitions that establish it', async () => {
        const view = mountView();
        selectTable(view);
        await flushFrames();

        expect(getCellSelection(view.state)).not.toBeNull();
    });

    it('drops the selection when only one end of a range leaves the table', async () => {
        const view = mountView();
        selectTable(view);

        view.dispatch({ selection: { anchor: TABLE_TO - 1, head: DOC.length } });
        await flushFrames();

        expect(getCellSelection(view.state)).toBeNull();
    });

    it('preserves a replacement selection through parser recovery', async () => {
        const view = mountView();
        selectTable(view);

        // CodeMirror checks Date.now between parser steps. Advancing the clock beyond the
        // production budget on every check forces a deterministic timeout.
        let now = 0;
        const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => {
            now += CLOCK_ADVANCE_MS;
            return now;
        });

        try {
            view.dispatch({
                changes: { from: view.state.doc.length, insert: `\n\n${LONG_TABLE_DOCUMENT}` },
                selection: { anchor: TABLE_FROM + 1 },
                effects: setCellSelectionEffect.of({
                    tableFrom: TABLE_FROM,
                    anchor: { section: 'header', row: 0, col: 0 },
                    focus: { section: 'body', row: 0, col: 1 },
                }),
                annotations: cellSelectionTransitionAnnotation.of(true),
            });

            expect(view.state.field(tableContextField).treeIncomplete).toBe(true);
            expect(getTableContextAtPos(view.state, TABLE_FROM)).toBeNull();

            view.dispatch({ selection: { anchor: 0 } });
            await flushFrames();

            expect(getCellSelection(view.state)).not.toBeNull();
        } finally {
            dateNow.mockRestore();
        }

        expect(ensureSyntaxTree(view.state, view.state.doc.length, COMPLETE_PARSE_TIMEOUT_MS)).not.toBeNull();
        view.dispatch({});

        expect(view.state.field(tableContextField).treeIncomplete).toBe(false);
        expect(getTableContextAtPos(view.state, TABLE_FROM)).not.toBeNull();
        expect(getCellSelection(view.state)).not.toBeNull();

        view.dispatch({ selection: { anchor: 1 } });
        await flushFrames();

        expect(getCellSelection(view.state)).toBeNull();
    });
});
