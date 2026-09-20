import { markdown } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hostEditorConfigFacet } from '../services/hostEditorConfig';
import { createMarkdownRenderer, markdownRenderServiceFacet } from '../services/markdownRenderer';
import { isNestedEditorOpen, nestedEditorPlugin, openNestedEditor } from '../nestedEditor/nestedEditorController';
import { requireResolvedActiveCell } from './testUtils';
import { activeCellField, setActiveCellEffect, type ActiveCell } from '../tableState/activeCellState';
import { tableContextField } from '../tableState/tableContextField';
import { openCellRequestField } from '../tableRuntime/openCellRequest';
import { resolveTableContextFromEventTarget } from '../tableRuntime/tablePositioning';
import { tableDecorationField } from '../tableWidget/tableDecorationField';
import { findCellElement, findTableWidgetElement } from '../tableWidget/domHelpers';
import type { CellCoords } from '../tableModel/types';
import { createResizeObserverStub } from './tableEditorFixtures';

const resizeObserver = createResizeObserverStub();

const TEST_HOST_CONFIG = {
    nestedEditor: { autoMatchingBraces: true, spellcheck: false },
    tableAppearance: { zebraStriping: false },
    toolbar: {
        showMoveButtons: true,
        showClearButtons: true,
        showAlignmentButtons: true,
        showDeleteTableButton: true,
        showSortButtons: true,
    },
};

const TABLE_A = ['| A1 | A2 |', '| --- | --- |', '| **a** | b |'].join('\n');
const TABLE_B = ['| B1 | B2 |', '| --- | --- |', '| c | d |'].join('\n');
const DOC = `intro\n\n${TABLE_A}\n\n${TABLE_B}\n\nend`;
const TABLE_A_FROM = DOC.indexOf(TABLE_A);
const TABLE_B_FROM = DOC.indexOf(TABLE_B);

function createView(): EditorView {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    return new EditorView({
        parent,
        state: EditorState.create({
            doc: DOC,
            selection: EditorSelection.single(0),
            extensions: [
                markdown({ extensions: [GFM] }),
                hostEditorConfigFacet.of(TEST_HOST_CONFIG),
                markdownRenderServiceFacet.of(createMarkdownRenderer(async (markup, id) => ({ id, html: markup }))),
                nestedEditorPlugin,
                tableContextField,
                activeCellField,
                openCellRequestField,
                tableDecorationField,
            ],
        }),
    });
}

function requireCell(view: EditorView, tableFrom: number, cell: CellCoords): HTMLElement {
    const element = findCellElement(view, tableFrom, cell);
    if (!element) {
        throw new Error(`Expected a rendered cell in the table at ${tableFrom}`);
    }
    return element;
}

describe('resolveTableContextFromEventTarget', () => {
    beforeEach(() => {
        resizeObserver.install();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        document.body.innerHTML = '';
    });

    it('resolves each cell and its rendered content to the table that renders it', () => {
        const view = createView();

        for (const tableFrom of [TABLE_A_FROM, TABLE_B_FROM]) {
            const cell = requireCell(view, tableFrom, { section: 'body', row: 0, col: 0 });
            expect(resolveTableContextFromEventTarget(view, cell)?.from).toBe(tableFrom);
            for (const descendant of cell.querySelectorAll<HTMLElement>('*')) {
                expect(resolveTableContextFromEventTarget(view, descendant)?.from).toBe(tableFrom);
            }
        }

        view.destroy();
    });

    it('resolves a cell in another table while a nested editor is open, and the editor to its own table', () => {
        const view = createView();
        const activeCell: ActiveCell = { tableFrom: TABLE_A_FROM, section: 'body', row: 0, col: 1 };
        view.dispatch({ effects: setActiveCellEffect.of(activeCell) });
        expect(
            openNestedEditor({
                mainView: view,
                resolvedCell: requireResolvedActiveCell(view.state),
                cellElement: requireCell(view, TABLE_A_FROM, activeCell),
                featureSettings: TEST_HOST_CONFIG.nestedEditor,
            })
        ).toBe(true);
        expect(isNestedEditorOpen(view)).toBe(true);

        const otherTableCell = requireCell(view, TABLE_B_FROM, { section: 'header', row: 0, col: 1 });
        expect(resolveTableContextFromEventTarget(view, otherTableCell)?.from).toBe(TABLE_B_FROM);

        const nestedLine = requireCell(view, TABLE_A_FROM, activeCell).querySelector<HTMLElement>('.cm-line');
        expect(nestedLine).not.toBeNull();
        expect(resolveTableContextFromEventTarget(view, nestedLine as HTMLElement)?.from).toBe(TABLE_A_FROM);

        view.destroy();
    });

    // Table lookups from widget DOM match the table by its exact start, which relies on this.
    it('maps every node inside a widget, including a nested editor, to exactly its table start', () => {
        const view = createView();
        const activeCell: ActiveCell = { tableFrom: TABLE_A_FROM, section: 'body', row: 0, col: 1 };
        view.dispatch({ effects: setActiveCellEffect.of(activeCell) });
        openNestedEditor({
            mainView: view,
            resolvedCell: requireResolvedActiveCell(view.state),
            cellElement: requireCell(view, TABLE_A_FROM, activeCell),
            featureSettings: TEST_HOST_CONFIG.nestedEditor,
        });
        expect(requireCell(view, TABLE_A_FROM, activeCell).querySelector('.cm-editor .cm-line')).not.toBeNull();

        for (const tableFrom of [TABLE_A_FROM, TABLE_B_FROM]) {
            const widget = findTableWidgetElement(view, tableFrom);
            expect(widget).not.toBeNull();

            const walker = document.createTreeWalker(widget as HTMLElement);
            for (let node: Node | null = widget; node; node = walker.nextNode()) {
                const endOffset =
                    node.nodeType === Node.TEXT_NODE ? (node.textContent ?? '').length : node.childNodes.length;
                expect(view.posAtDOM(node, 0)).toBe(tableFrom);
                expect(view.posAtDOM(node, endOffset)).toBe(tableFrom);
            }
        }

        view.destroy();
    });
});
