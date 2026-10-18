import { EditorSelection, EditorState, type SelectionRange } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { buildCellSelectionRanges, cellTextFromContext } from '../tableRuntime/selection/cellSelectionRanges';
import { setCellDragSelection } from '../tableRuntime/selection/cellSelectionController';
import { tableSelectionSnapFilter } from '../tableRuntime/selection/tableSelectionSnap';
import { getCellSelection, toSelectionRect } from '../tableState/cellSelectionState';
import {
    buildMultiCellPasteRewrite,
    createTableClipboardRewriteSpec,
} from '../tableRuntime/selection/cellSelectionClipboard';
import { getTableContextStartingAt } from '../tableState/tableContextField';
import type { TableContext } from '../tableModel/tableContext';
import type { CellCoords, TableRect } from '../tableModel/types';
import { cellSelectionTestExtensions } from './tableEditorFixtures';
import { createMarkdownState } from './testMarkdownState';

const GRID_DOC = ['| H1 | H2 | H3 |', '| --- | --- | --- |', '| a1 | a2 | a3 |', '| b1 | b2 | b3 |'].join('\n');
/** `a2` and `b1` are empty; the last row is missing its third cell. */
const SPARSE_DOC = ['| H1 | H2 | H3 |', '| --- | --- | --- |', '| a1 |  | a3 |', '|  | b2 |'].join('\n');

const BODY_RECT: TableRect = { minRow: 1, maxRow: 2, minCol: 0, maxCol: 2 };
const BOLD_MARKER = '**';

function body(row: number, col: number): CellCoords {
    return { section: 'body', row, col };
}

function tableContext(doc: string): { state: EditorState; ctx: TableContext } {
    const state = createMarkdownState(doc, [EditorState.allowMultipleSelections.of(true)]);
    const ctx = getTableContextStartingAt(state, 0);
    if (!ctx) {
        throw new Error('test document has no table at 0');
    }
    return { state, ctx };
}

function buildFromContext(ctx: TableContext, rect: TableRect, focus: CellCoords): EditorSelection {
    return buildCellSelectionRanges({ tableFrom: ctx.from, rect, focus, cellText: cellTextFromContext(ctx) });
}

function rangeTexts(state: EditorState, ranges: readonly SelectionRange[]): string[] {
    return ranges.map((range) => state.sliceDoc(range.from, range.to));
}

/** Wraps every selection range in bold markers, the way the host's inline formatting commands do. */
function boldEveryRange(view: EditorView): void {
    view.dispatch(
        view.state.changeByRange((range) => ({
            changes: [
                { from: range.from, insert: BOLD_MARKER },
                { from: range.to, insert: BOLD_MARKER },
            ],
            range: EditorSelection.range(range.from + BOLD_MARKER.length, range.to + BOLD_MARKER.length),
        }))
    );
}

const mountedViews: EditorView[] = [];

function mountView(doc: string): EditorView {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
        parent,
        doc,
        extensions: cellSelectionTestExtensions(EditorState.allowMultipleSelections.of(true), tableSelectionSnapFilter),
    });
    mountedViews.push(view);
    return view;
}

afterEach(() => {
    while (mountedViews.length > 0) {
        mountedViews.pop()?.destroy();
    }
    document.body.replaceChildren();
});

describe('buildCellSelectionRanges', () => {
    it('covers the text of every cell in the rectangle, with the focus cell as main', () => {
        const { state, ctx } = tableContext(GRID_DOC);

        const selection = buildFromContext(ctx, BODY_RECT, body(1, 1));

        expect(rangeTexts(state, selection.ranges)).toEqual(['a1', 'a2', 'a3', 'b1', 'b2', 'b3']);
        expect(state.sliceDoc(selection.main.from, selection.main.to)).toBe('b2');
    });

    it('covers header cells when the rectangle includes the header row', () => {
        const { state, ctx } = tableContext(GRID_DOC);

        const selection = buildFromContext(ctx, { minRow: 0, maxRow: 1, minCol: 1, maxCol: 1 }, body(0, 1));

        expect(rangeTexts(state, selection.ranges)).toEqual(['H2', 'a2']);
    });

    it('skips empty cells and cells a ragged row is missing', () => {
        const { state, ctx } = tableContext(SPARSE_DOC);

        const selection = buildFromContext(ctx, BODY_RECT, body(1, 1));

        expect(rangeTexts(state, selection.ranges)).toEqual(['a1', 'a3', 'b2']);
        expect(state.sliceDoc(selection.main.from, selection.main.to)).toBe('b2');
    });

    it('makes the first range main when the focus cell is empty', () => {
        const { state, ctx } = tableContext(SPARSE_DOC);

        const selection = buildFromContext(ctx, BODY_RECT, body(0, 1));

        expect(state.sliceDoc(selection.main.from, selection.main.to)).toBe('a1');
    });

    it('collapses to a caret at the focus cell when no selected cell has text', () => {
        const { ctx } = tableContext(SPARSE_DOC);
        const emptyCellRect: TableRect = { minRow: 1, maxRow: 1, minCol: 1, maxCol: 1 };

        const selection = buildFromContext(ctx, emptyCellRect, body(0, 1));

        expect(selection.ranges).toHaveLength(1);
        expect(selection.main.empty).toBe(true);
        expect(selection.main.head).toBe(ctx.from + ctx.cellRanges.rows[0][1].editableFrom);
    });
});

describe('cell selection main-editor ranges', () => {
    it('keeps one range per cell when a drag starts from a rendered cell', () => {
        const view = mountView(GRID_DOC);

        setCellDragSelection(view, 0, body(0, 0), body(1, 1));

        expect(getCellSelection(view.state)).not.toBeNull();
        expect(rangeTexts(view.state, view.state.selection.ranges)).toEqual(['a1', 'a2', 'b1', 'b2']);
    });

    it('lets a per-range formatting command format every selected cell', () => {
        const view = mountView(GRID_DOC);
        setCellDragSelection(view, 0, body(0, 0), body(1, 1));

        boldEveryRange(view);

        expect(view.state.doc.toString()).toBe(
            ['| H1 | H2 | H3 |', '| --- | --- | --- |', '| **a1** | **a2** | a3 |', '| **b1** | **b2** | b3 |'].join(
                '\n'
            )
        );
    });
});

describe('paste rewrite main-editor ranges', () => {
    it.each([
        ['plain cells', ['| P1 | P2 |', '| --- | --- |', '| Q1 | Q2 |']],
        [
            'escaped pipes and line breaks',
            [String.raw`| P\|1 | P<br>2 |`, '| --- | --- |', String.raw`| Q1 | x\|y<br>z |`],
        ],
        [
            'a fragment that grows the table',
            ['| P1 | P2 | P3 | P4 |', '| --- | --- | --- | --- |', '| Q1 | Q2 | Q3 | Q4 |', '| R1 | R2 | R3 | R4 |'],
        ],
    ])('matches the ranges the re-indexed table yields for %s', (_label, fragmentLines) => {
        const { state, ctx } = tableContext(GRID_DOC);
        const rewrite = buildMultiCellPasteRewrite(
            { ctx, anchor: body(0, 1), source: 'selection', rect: { minRow: 1, maxRow: 2, minCol: 1, maxCol: 2 } },
            fragmentLines.join('\n')
        );
        if (!rewrite?.selection) {
            throw new Error('paste produced no cell selection');
        }

        const next = state.update(createTableClipboardRewriteSpec(state, rewrite)).state;
        const nextCtx = getTableContextStartingAt(next, 0);
        if (!nextCtx) {
            throw new Error('rewritten table is not indexed');
        }
        const expected = buildFromContext(nextCtx, toSelectionRect(rewrite.selection), rewrite.selection.focus);

        expect(next.selection.ranges).toEqual(expected.ranges);
        expect(next.selection.mainIndex).toBe(expected.mainIndex);
        expect(next.selection.ranges.length).toBeGreaterThan(1);
    });
});
