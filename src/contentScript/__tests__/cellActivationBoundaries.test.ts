/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { activateCellAtPosition } from '../tableRuntime/activeCell/cellActivation';
import { activeCellField } from '../tableState/activeCellState';
import { sourceModeField } from '../tableState/sourceMode';
import { createMarkdownState } from './testMarkdownState';

const TABLE = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');

function withView<T>(doc: string, run: (view: EditorView) => T): T {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
        parent,
        state: createMarkdownState(doc, [activeCellField, sourceModeField]),
    });

    try {
        return run(view);
    } finally {
        view.destroy();
        parent.remove();
    }
}

describe('activateCellAtPosition table boundaries', () => {
    it('activates a cell for a position inside the table', () => {
        expect(withView(TABLE, (view) => activateCellAtPosition(view, TABLE.indexOf('a1')))).toBe(true);
    });

    it('activates a cell for a position at the very end of the table', () => {
        expect(withView(TABLE, (view) => activateCellAtPosition(view, TABLE.length))).toBe(true);
    });

    it('does not activate a cell for text that Lezer folds into the table node', () => {
        // Lezer extends a `Table` node over following non-blank lines until a blank line.
        // Without a containment check against the trimmed range, this position resolves to
        // the table above and activates one of its cells.
        const doc = `${TABLE}\ntrailing text`;

        expect(withView(doc, (view) => activateCellAtPosition(view, doc.indexOf('trailing')))).toBe(false);
    });

    it('does not activate a cell for a position in a separate paragraph', () => {
        const doc = `${TABLE}\n\nparagraph`;

        expect(withView(doc, (view) => activateCellAtPosition(view, doc.indexOf('paragraph')))).toBe(false);
    });
});
