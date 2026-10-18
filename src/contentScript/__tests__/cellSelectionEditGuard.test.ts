import { describe, expect, it } from 'vitest';
import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state';
import { activeCellField, setActiveCellEffect } from '../tableState/activeCellState';
import { cellSelectionField, getCellSelection, setCellSelectionEffect } from '../tableState/cellSelectionState';
import { sourceModeField } from '../tableState/sourceMode';
import { structuralTableEditEffect } from '../tableState/structuralTableEditEffect';
import { decideMainEditorGuardTransaction } from '../tableRuntime/guard/mainEditorGuardPolicy';
import { createMainEditorActiveCellGuard } from '../tableRuntime/guard/mainEditorGuard';
import { createMarkdownState } from './testMarkdownState';

const TABLE = ['| H1 | H2 | H3 |', '| --- | --- | --- |', '| a1 | a2 | a3 |', '| b1 | b2 | b3 |'].join('\n');
const AFTER = 'after';
const DOC = `${TABLE}\n\n${AFTER}`;
const BOLD_MARKER = '**';

const ALLOW = { type: 'allowTransaction' };
const REJECT = { type: 'rejectTransaction' };

function pos(text: string): number {
    const index = DOC.indexOf(text);
    if (index < 0) {
        throw new Error(`"${text}" is not in the test document`);
    }
    return index;
}

const SELECTION_EFFECT = setCellSelectionEffect.of({
    tableFrom: 0,
    anchor: { section: 'body', row: 0, col: 0 },
    focus: { section: 'body', row: 1, col: 1 },
});

function createBaseState(): EditorState {
    return createMarkdownState(DOC, [activeCellField, cellSelectionField, sourceModeField]);
}

/** A state with body cells (0,0)–(1,1) — `a1`, `a2`, `b1`, `b2` — selected. */
function createSelectedState(): EditorState {
    return createBaseState().update({ effects: SELECTION_EFFECT }).state;
}

function decide(spec: TransactionSpec, state = createSelectedState()): unknown {
    return decideMainEditorGuardTransaction(state.update(spec), { nestedEditorOpen: false });
}

function wrapInBold(...cellTexts: string[]): TransactionSpec {
    return {
        changes: cellTexts.flatMap((text) => [
            { from: pos(text), insert: BOLD_MARKER },
            { from: pos(text) + text.length, insert: BOLD_MARKER },
        ]),
    };
}

describe('main-editor guard under a cell selection', () => {
    it('allows formatting confined to the selected cells', () => {
        expect(decide(wrapInBold('a1', 'a2', 'b1', 'b2'))).toEqual(ALLOW);
    });

    it.each([
        ['a heading marker at a row start', { changes: { from: pos('| a1'), insert: '# ' } }],
        [
            'a code fence around a cell',
            {
                changes: [
                    { from: pos('a1'), insert: '```\n' },
                    { from: pos('a1') + 2, insert: '\n```' },
                ],
            },
        ],
        ['a pipe inside a selected cell', { changes: { from: pos('a1'), insert: '|' } }],
        ['text in an unselected cell', wrapInBold('a1', 'a3')],
        ['text right after the table', { changes: { from: TABLE.length, insert: 'x' } }],
    ])('rejects %s', (_label, spec: TransactionSpec) => {
        expect(decide(spec)).toEqual(REJECT);
    });

    it('allows edits away from the selected table', () => {
        expect(decide({ changes: { from: pos(AFTER), insert: 'x' } })).toEqual(ALLOW);
    });

    it('allows undo and redo to rewrite the table', () => {
        const rowStart = { from: pos('| a1'), insert: '# ' };

        expect(decide({ changes: rowStart, userEvent: 'undo' })).toEqual(ALLOW);
        expect(decide({ changes: rowStart, userEvent: 'redo' })).toEqual(ALLOW);
    });

    it('allows structural table edits', () => {
        expect(
            decide({
                changes: { from: 0, to: TABLE.length, insert: TABLE.replace('a1', 'x') },
                effects: structuralTableEditEffect.of(null),
            })
        ).toEqual(ALLOW);
    });

    it('defers to the active-cell guard while a drag keeps its anchor cell open', () => {
        // Setting an active cell clears a selection, so a drag's overlap sets both in this order.
        const state = createBaseState().update({
            effects: [setActiveCellEffect.of({ tableFrom: 0, section: 'body', row: 0, col: 0 }), SELECTION_EFFECT],
            selection: EditorSelection.single(pos('a1')),
        }).state;

        expect(decide({ changes: { from: pos('| a1'), insert: '# ' } }, state)).toEqual(ALLOW);
    });

    it('leaves the document and the selection untouched when the guard filter rejects an edit', () => {
        const state = createMarkdownState(DOC, [
            activeCellField,
            cellSelectionField,
            sourceModeField,
            createMainEditorActiveCellGuard(() => false),
        ]).update({ effects: SELECTION_EFFECT }).state;
        const selection = getCellSelection(state);

        const next = state.update({ changes: { from: pos('| a1'), insert: '# ' } }).state;

        expect(next.doc.toString()).toBe(DOC);
        expect(getCellSelection(next)).toEqual(selection);
    });
});

describe('main-editor guard with escaped pipes in selected cells', () => {
    const PIPE_TABLE = [
        '| Request Type | Note |',
        '| --- | --- |',
        '| PUT | **Single Record** |',
        String.raw`| POST | **ls \| grep** |`,
    ].join('\n');
    const ESCAPED_PIPE_CELL = String.raw`**ls \| grep**`;

    /** The `Note` column's two body cells selected. */
    function createPipeTableState(): EditorState {
        return createMarkdownState(PIPE_TABLE, [activeCellField, cellSelectionField, sourceModeField]).update({
            effects: setCellSelectionEffect.of({
                tableFrom: 0,
                anchor: { section: 'body', row: 0, col: 1 },
                focus: { section: 'body', row: 1, col: 1 },
            }),
        }).state;
    }

    function decideOnPipeTable(spec: TransactionSpec): unknown {
        return decideMainEditorGuardTransaction(createPipeTableState().update(spec), { nestedEditorOpen: false });
    }

    /** What the host's bold toggle dispatches for a bold cell: its whole span, re-inserted without markers. */
    function unwrapBold(cellText: string): { from: number; to: number; insert: string } {
        const from = PIPE_TABLE.indexOf(cellText);
        return { from, to: from + cellText.length, insert: cellText.slice(BOLD_MARKER.length, -BOLD_MARKER.length) };
    }

    it('allows unbolding cells whose re-inserted content holds an escaped pipe', () => {
        expect(
            decideOnPipeTable({ changes: [unwrapBold('**Single Record**'), unwrapBold(ESCAPED_PIPE_CELL)] })
        ).toEqual(ALLOW);
    });

    it('allows inserting an escaped pipe', () => {
        expect(decideOnPipeTable({ changes: { from: PIPE_TABLE.indexOf('Single'), insert: String.raw`\|` } })).toEqual(
            ALLOW
        );
    });

    it('rejects deleting the backslash that escapes a pipe', () => {
        const backslash = PIPE_TABLE.indexOf(String.raw`\|`);

        expect(decideOnPipeTable({ changes: { from: backslash, to: backslash + 1 } })).toEqual(REJECT);
    });
});
