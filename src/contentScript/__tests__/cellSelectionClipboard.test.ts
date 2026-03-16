/**
 * @jest-environment jsdom
 */

import { EditorView } from '@codemirror/view';
import { activeCellField, getActiveCell, setActiveCellEffect } from '../tableState/activeCellState';
import {
    cellSelectionField,
    getCellSelection,
    setCellSelectionEffect,
    type CellSelection,
} from '../tableState/cellSelectionState';
import { createMarkdownState } from './testMarkdownState';
import {
    buildMultiCellPasteRewrite,
    buildSelectionCutRewrite,
    buildSelectionRemovalRewrite,
    copySelectionAsMarkdown,
    extractSelectedCellContents,
    handleSelectionDelete,
    handleTableClipboardPaste,
    handleTableClipboardTextPaste,
    parseMarkdownTableClipboard,
    resolveTableClipboardTarget,
} from '../tableRuntime/cellSelectionClipboard';
import { CLASS_CELL_EDITOR } from '../shared/tableDomClasses';

const doc = ['| H\\|1 | H2 | H3 |', '| :--- | ---: | --- |', '| a | b\\|c |  |', '| x | <br> | z |'].join('\n');

function selection(anchor: CellSelection['anchor'], focus: CellSelection['focus']): CellSelection {
    return { tableFrom: 0, anchor, focus };
}

interface MutableClipboardTestView {
    state: ReturnType<typeof createMarkdownState>;
    dispatch: jest.Mock;
    focus: jest.Mock;
    dom: HTMLElement;
    contentDOM: HTMLElement;
    scrollDOM: HTMLElement;
}

function setActiveElement(element: Element | null): void {
    Object.defineProperty(document, 'activeElement', {
        configurable: true,
        get: () => element,
    });
}

describe('cellSelectionClipboard', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        setActiveElement(document.body);
    });

    it('extracts header-only selections', () => {
        const state = createMarkdownState(doc);

        expect(
            extractSelectedCellContents(
                state,
                selection({ section: 'header', row: 0, col: 0 }, { section: 'header', row: 0, col: 1 })
            )
        ).toEqual([['H\\|1', 'H2']]);
    });

    it('extracts body-only selections', () => {
        const state = createMarkdownState(doc);

        expect(
            extractSelectedCellContents(
                state,
                selection({ section: 'body', row: 0, col: 1 }, { section: 'body', row: 1, col: 2 })
            )
        ).toEqual([
            ['b\\|c', ''],
            ['<br>', 'z'],
        ]);
    });

    it('extracts selections spanning header and body rows', () => {
        const state = createMarkdownState(doc);

        expect(
            extractSelectedCellContents(
                state,
                selection({ section: 'header', row: 0, col: 1 }, { section: 'body', row: 0, col: 2 })
            )
        ).toEqual([
            ['H2', 'H3'],
            ['b\\|c', ''],
        ]);
    });

    it('serializes selections with original alignments when the header is included', () => {
        const state = createMarkdownState(doc);

        expect(
            copySelectionAsMarkdown(
                state,
                selection({ section: 'header', row: 0, col: 0 }, { section: 'body', row: 1, col: 1 })
            )
        ).toBe(['| H\\|1 | H2 |', '| :--- | ---: |', '| a | b\\|c |', '| x | <br> |'].join('\n'));
    });

    it('serializes body-only selections as a valid standalone markdown table', () => {
        const state = createMarkdownState(doc);

        expect(
            copySelectionAsMarkdown(
                state,
                selection({ section: 'body', row: 0, col: 0 }, { section: 'body', row: 1, col: 1 })
            )
        ).toBe(['| a | b\\|c |', '| --- | --- |', '| x | <br> |'].join('\n'));
    });

    it('serializes vertical single-column selections without turning them into a row', () => {
        const state = createMarkdownState(doc);

        expect(
            copySelectionAsMarkdown(
                state,
                selection({ section: 'body', row: 0, col: 0 }, { section: 'body', row: 1, col: 0 })
            )
        ).toBe(['| a |', '| --- |', '| x |'].join('\n'));
    });

    it('parses clipboard markdown into a cell matrix plus alignments', () => {
        expect(parseMarkdownTableClipboard(['| H1 | H2 |', '| :--- | ---: |', '| A1 | A2 |'].join('\n'))).toEqual({
            cells: [
                ['H1', 'H2'],
                ['A1', 'A2'],
            ],
            alignments: ['left', 'right'],
        });
    });

    it('uses the selection top-left cell as the paste anchor', () => {
        let state = createMarkdownState(doc, [cellSelectionField]);
        state = state.update({
            effects: setCellSelectionEffect.of(
                selection({ section: 'body', row: 1, col: 2 }, { section: 'header', row: 0, col: 1 })
            ),
        }).state;

        expect(resolveTableClipboardTarget(state, { nestedEditorOpen: false })).toEqual({
            tableFrom: 0,
            anchor: { section: 'header', row: 0, col: 1 },
            source: 'selection',
        });
    });

    it('uses the active cell as the paste anchor when the nested editor is open', () => {
        let state = createMarkdownState(doc, [activeCellField]);
        state = state.update({
            effects: setActiveCellEffect.of({
                anchorPos: doc.indexOf('b\\|c'),
                tableFrom: 0,
                section: 'body',
                row: 0,
                col: 1,
            }),
        }).state;

        expect(resolveTableClipboardTarget(state, { nestedEditorOpen: true })).toEqual({
            tableFrom: 0,
            anchor: { section: 'body', row: 0, col: 1 },
            source: 'activeCell',
        });
    });

    it('returns no anchor when neither a selection nor open nested editor is available', () => {
        const state = createMarkdownState(doc, [activeCellField]);

        expect(resolveTableClipboardTarget(state, { nestedEditorOpen: false })).toBeNull();
    });

    it('builds a cut rewrite that preserves the selected rectangle', () => {
        const state = createMarkdownState(doc);
        const rewrite = buildSelectionCutRewrite(
            state,
            selection({ section: 'header', row: 0, col: 1 }, { section: 'body', row: 1, col: 2 })
        );

        expect(rewrite).not.toBeNull();
        expect(rewrite?.tableText).toBe(
            ['| H\\|1 |  |  |', '| :--- | ---: | --- |', '| a |  |  |', '| x |  |  |'].join('\n')
        );
        expect(rewrite?.selection).toEqual(
            selection({ section: 'header', row: 0, col: 1 }, { section: 'body', row: 1, col: 2 })
        );
    });

    it('clears non-empty selections instead of structurally deleting them', () => {
        const state = createMarkdownState(doc);
        const rewrite = buildSelectionRemovalRewrite(
            state,
            selection({ section: 'header', row: 0, col: 0 }, { section: 'body', row: 1, col: 2 })
        );

        expect(rewrite).not.toBeNull();
        expect(rewrite?.tableText).toBe(['|  |  |  |', '| :--- | ---: | --- |', '|  |  |  |', '|  |  |  |'].join('\n'));
        expect(rewrite?.selection).toEqual(
            selection({ section: 'header', row: 0, col: 0 }, { section: 'body', row: 1, col: 2 })
        );
    });

    it('deletes empty full-row selections and remaps the selection to surviving rows', () => {
        const emptyRowDoc = ['| H1 | H2 |', '| --- | --- |', '| A1 | A2 |', '|  |  |', '| B1 | B2 |'].join('\n');
        const state = createMarkdownState(emptyRowDoc);
        const rewrite = buildSelectionRemovalRewrite(
            state,
            selection({ section: 'body', row: 1, col: 0 }, { section: 'body', row: 1, col: 1 })
        );

        expect(rewrite).not.toBeNull();
        expect(rewrite?.tableText).toBe(['| H1 | H2 |', '| --- | --- |', '| A1 | A2 |', '| B1 | B2 |'].join('\n'));
        expect(rewrite?.selection).toEqual(
            selection({ section: 'body', row: 1, col: 0 }, { section: 'body', row: 1, col: 1 })
        );
    });

    it('deletes empty full-column selections and remaps the selection to surviving columns', () => {
        const emptyColumnDoc = ['| H1 |  | H3 |', '| --- | --- | --- |', '| A1 |  | A3 |', '| B1 |  | B3 |'].join('\n');
        const state = createMarkdownState(emptyColumnDoc);
        const rewrite = buildSelectionRemovalRewrite(
            state,
            selection({ section: 'header', row: 0, col: 1 }, { section: 'body', row: 1, col: 1 })
        );

        expect(rewrite).not.toBeNull();
        expect(rewrite?.tableText).toBe(['| H1 | H3 |', '| --- | --- |', '| A1 | A3 |', '| B1 | B3 |'].join('\n'));
        expect(rewrite?.selection).toEqual(
            selection({ section: 'header', row: 0, col: 1 }, { section: 'body', row: 1, col: 1 })
        );
    });

    it('deletes the whole table when the full selected table is empty', () => {
        const emptyTableDoc = ['|  |  |', '| --- | --- |', '|  |  |'].join('\n');
        const state = createMarkdownState(emptyTableDoc);
        const rewrite = buildSelectionRemovalRewrite(
            state,
            selection({ section: 'header', row: 0, col: 0 }, { section: 'body', row: 0, col: 1 })
        );

        expect(rewrite).not.toBeNull();
        expect(rewrite?.tableText).toBe('');
        expect(rewrite?.selection).toBeNull();
        expect(rewrite?.clearActiveCell).toBe(true);
        expect(rewrite?.selectionAnchorPos).toBe(0);
    });

    it('uses the structural empty-row deletion path for Ctrl+X too', () => {
        const emptyRowDoc = ['| H1 | H2 |', '| --- | --- |', '| A1 | A2 |', '|  |  |', '| B1 | B2 |'].join('\n');
        const state = createMarkdownState(emptyRowDoc);
        const rewrite = buildSelectionCutRewrite(
            state,
            selection({ section: 'body', row: 1, col: 0 }, { section: 'body', row: 1, col: 1 })
        );

        expect(rewrite?.tableText).toBe(['| H1 | H2 |', '| --- | --- |', '| A1 | A2 |', '| B1 | B2 |'].join('\n'));
    });

    it('deletes the final empty body row and remaps the selection to the header row', () => {
        const state = createMarkdownState(['| H1 | H2 |', '| --- | --- |', '|  |  |'].join('\n'));
        const rewrite = buildSelectionRemovalRewrite(
            state,
            selection({ section: 'body', row: 0, col: 0 }, { section: 'body', row: 0, col: 1 })
        );

        expect(rewrite).not.toBeNull();
        expect(rewrite?.tableText).toBe(['| H1 | H2 |', '| --- | --- |'].join('\n'));
        expect(rewrite?.selection).toEqual(
            selection({ section: 'header', row: 0, col: 0 }, { section: 'header', row: 0, col: 1 })
        );
    });

    it('builds a paste rewrite from the selection top-left even when the pasted range is smaller', () => {
        let state = createMarkdownState(doc, [cellSelectionField]);
        state = state.update({
            effects: setCellSelectionEffect.of(
                selection({ section: 'body', row: 1, col: 2 }, { section: 'header', row: 0, col: 1 })
            ),
        }).state;

        const target = resolveTableClipboardTarget(state, { nestedEditorOpen: false });
        const rewrite = buildMultiCellPasteRewrite(state, target!, ['| P1 |', '| --- |', '| Q1 |'].join('\n'));

        expect(rewrite).not.toBeNull();
        expect(rewrite?.tableText).toBe(
            ['| H\\|1 | P1 | H3 |', '| :--- | ---: | --- |', '| a | Q1 |  |', '| x | <br> | z |'].join('\n')
        );
        expect(rewrite?.selection).toEqual(
            selection({ section: 'header', row: 0, col: 1 }, { section: 'body', row: 0, col: 1 })
        );
        expect(rewrite?.clearActiveCell).toBe(false);
    });

    it('builds an expanding paste rewrite from the active nested-editor cell', () => {
        let state = createMarkdownState(doc, [activeCellField]);
        state = state.update({
            effects: setActiveCellEffect.of({
                anchorPos: doc.indexOf('b\\|c'),
                tableFrom: 0,
                section: 'body',
                row: 0,
                col: 1,
            }),
        }).state;

        const target = resolveTableClipboardTarget(state, { nestedEditorOpen: true });
        const rewrite = buildMultiCellPasteRewrite(
            state,
            target!,
            ['| P1 | P2 | P3 |', '| :--- | ---: | :---: |', '| Q1 | Q2 | Q3 |', '| R1 | R2 | R3 |'].join('\n')
        );

        expect(rewrite).not.toBeNull();
        expect(rewrite?.tableText).toBe(
            [
                '| H\\|1 | H2 | H3 |  |',
                '| :--- | ---: | --- | :---: |',
                '| a | P1 | P2 | P3 |',
                '| x | Q1 | Q2 | Q3 |',
                '|  | R1 | R2 | R3 |',
            ].join('\n')
        );
        expect(rewrite?.selection).toEqual(
            selection({ section: 'body', row: 0, col: 1 }, { section: 'body', row: 2, col: 3 })
        );
        expect(rewrite?.clearActiveCell).toBe(true);
    });

    it('returns null for invalid clipboard markdown', () => {
        const state = createMarkdownState(doc);
        const target = {
            tableFrom: 0,
            anchor: { section: 'body', row: 0, col: 1 } as const,
            source: 'selection' as const,
        };

        expect(buildMultiCellPasteRewrite(state, target, 'plain text')).toBeNull();
    });

    it('handles nested-editor paste through the main capture path', () => {
        let currentState = createMarkdownState(doc, [activeCellField, cellSelectionField]);
        currentState = currentState.update({
            effects: setActiveCellEffect.of({
                anchorPos: doc.indexOf('b\\|c'),
                tableFrom: 0,
                section: 'body',
                row: 0,
                col: 1,
            }),
        }).state;

        const root = document.createElement('div');
        const nestedEditor = document.createElement('div');
        nestedEditor.className = CLASS_CELL_EDITOR;
        const nestedContent = document.createElement('div');
        nestedContent.setAttribute('contenteditable', 'true');
        nestedEditor.appendChild(nestedContent);
        root.appendChild(nestedEditor);
        document.body.appendChild(root);
        setActiveElement(nestedContent);

        const mutableView: MutableClipboardTestView = {
            state: currentState,
            dispatch: jest.fn((spec: Parameters<EditorView['dispatch']>[0]) => {
                currentState = currentState.update(spec).state;
                mutableView.state = currentState;
            }),
            focus: jest.fn(),
            dom: root,
            contentDOM: root,
            scrollDOM: root,
        };
        const view = mutableView as unknown as EditorView;

        const closeNestedEditor = jest.fn();
        const event = {
            clipboardData: {
                getData: jest.fn(() => ['| P1 | P2 |', '| :--- | ---: |', '| Q1 | Q2 |'].join('\n')),
            },
            preventDefault: jest.fn(),
        } as unknown as ClipboardEvent;

        expect(
            handleTableClipboardPaste(event, view, {
                nestedEditorOpen: true,
                closeNestedEditor,
            })
        ).toBe(true);

        expect(closeNestedEditor).toHaveBeenCalledTimes(1);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(mutableView.state.doc.toString()).toBe(
            ['| H\\|1 | H2 | H3 |', '| :--- | ---: | --- |', '| a | P1 | P2 |', '| x | Q1 | Q2 |'].join('\n')
        );
        expect(getActiveCell(mutableView.state)).toBeNull();
        expect(getCellSelection(mutableView.state)).toEqual(
            selection({ section: 'body', row: 0, col: 1 }, { section: 'body', row: 1, col: 2 })
        );
        expect(mutableView.focus).toHaveBeenCalledTimes(1);
    });

    it('handles nested-editor paste through the CodeMirror input pipeline', () => {
        let currentState = createMarkdownState(doc, [activeCellField, cellSelectionField]);
        currentState = currentState.update({
            effects: setActiveCellEffect.of({
                anchorPos: doc.indexOf('b\\|c'),
                tableFrom: 0,
                section: 'body',
                row: 0,
                col: 1,
            }),
        }).state;

        const root = document.createElement('div');
        document.body.appendChild(root);
        setActiveElement(root);

        const mutableView: MutableClipboardTestView = {
            state: currentState,
            dispatch: jest.fn((spec: Parameters<EditorView['dispatch']>[0]) => {
                currentState = currentState.update(spec).state;
                mutableView.state = currentState;
            }),
            focus: jest.fn(),
            dom: root,
            contentDOM: root,
            scrollDOM: root,
        };
        const view = mutableView as unknown as EditorView;

        const closeNestedEditor = jest.fn();

        expect(
            handleTableClipboardTextPaste(['| P1 | P2 |', '| :--- | ---: |', '| Q1 | Q2 |'].join('\n'), view, {
                nestedEditorOpen: true,
                closeNestedEditor,
            })
        ).toBe(true);

        expect(closeNestedEditor).toHaveBeenCalledTimes(1);
        expect(mutableView.state.doc.toString()).toBe(
            ['| H\\|1 | H2 | H3 |', '| :--- | ---: | --- |', '| a | P1 | P2 |', '| x | Q1 | Q2 |'].join('\n')
        );
        expect(getActiveCell(mutableView.state)).toBeNull();
        expect(getCellSelection(mutableView.state)).toEqual(
            selection({ section: 'body', row: 0, col: 1 }, { section: 'body', row: 1, col: 2 })
        );
        expect(mutableView.focus).toHaveBeenCalledTimes(1);
    });

    it('dispatches delete/backspace removal through the shared selection rewrite path', () => {
        const emptyColumnDoc = ['| H1 |  | H3 |', '| --- | --- | --- |', '| A1 |  | A3 |', '| B1 |  | B3 |'].join('\n');
        let currentState = createMarkdownState(emptyColumnDoc, [cellSelectionField]);
        currentState = currentState.update({
            effects: setCellSelectionEffect.of(
                selection({ section: 'header', row: 0, col: 1 }, { section: 'body', row: 1, col: 1 })
            ),
        }).state;

        const root = document.createElement('div');
        document.body.appendChild(root);
        setActiveElement(document.body);

        const mutableView: MutableClipboardTestView = {
            state: currentState,
            dispatch: jest.fn((spec: Parameters<EditorView['dispatch']>[0]) => {
                currentState = currentState.update(spec).state;
                mutableView.state = currentState;
            }),
            focus: jest.fn(),
            dom: root,
            contentDOM: root,
            scrollDOM: root,
        };
        const view = mutableView as unknown as EditorView;

        expect(handleSelectionDelete(view)).toBe(true);
        expect(mutableView.state.doc.toString()).toBe(
            ['| H1 | H3 |', '| --- | --- |', '| A1 | A3 |', '| B1 | B3 |'].join('\n')
        );
        expect(getCellSelection(mutableView.state)).toEqual(
            selection({ section: 'header', row: 0, col: 1 }, { section: 'body', row: 1, col: 1 })
        );
        expect(mutableView.focus).not.toHaveBeenCalled();
    });
});
