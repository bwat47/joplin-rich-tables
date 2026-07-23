import { ensureSyntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { describe, expect, it, vi } from 'vitest';
import { tableDecorationField } from '../tableWidget/tableDecorationField';
import { createMarkdownState } from './testMarkdownState';

const TABLE_COUNT = 5;
const TABLE = ['| H1 | H2 |', '| --- | --- |', '| a | b |'].join('\n');
const FILLER = 'lorem ipsum dolor sit amet '.repeat(40);
const LONG_TABLE_DOCUMENT = Array.from({ length: TABLE_COUNT }, () => `${FILLER}\n\n${TABLE}`).join('\n\n');
const CLOCK_ADVANCE_MS = 2_000;
const COMPLETE_PARSE_TIMEOUT_MS = 1_000;

describe('tableDecorationField', () => {
    it('rebuilds incomplete decorations when parsing finishes without a document change', () => {
        // CodeMirror checks Date.now between parser steps. Advancing the clock beyond the
        // production budget on every check forces a deterministic timeout.
        let now = 0;
        const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => {
            now += CLOCK_ADVANCE_MS;
            return now;
        });

        let state: EditorState;
        try {
            state = createMarkdownState(LONG_TABLE_DOCUMENT, [tableDecorationField]);
        } finally {
            dateNow.mockRestore();
        }

        expect(state.field(tableDecorationField)).toMatchObject({
            decorations: { size: 0 },
            treeIncomplete: true,
        });

        expect(ensureSyntaxTree(state, state.doc.length, COMPLETE_PARSE_TIMEOUT_MS)).not.toBeNull();

        // ensureSyntaxTree advances the shared parse context. A subsequent empty transaction
        // exposes that completed tree, as CodeMirror's background parser does when it dispatches.
        const parserUpdate = state.update({});
        expect(parserUpdate.docChanged).toBe(false);
        state = parserUpdate.state;

        expect(state.field(tableDecorationField)).toMatchObject({
            decorations: { size: TABLE_COUNT },
            treeIncomplete: false,
        });
    });
});
