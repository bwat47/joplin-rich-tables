/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { CLASS_CELL_CONTENT } from '../shared/tableDomClasses';
import { indexRenderedText, flatOffsetFromDomPosition, type RenderedCaretHit } from '../tableWidget/cellCaretHit';
import { resolveClickCursorPos } from '../tableRuntime/interaction/clickCursorPlacement';
import { createResolvedActiveCell, type ResolvedActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import { resolveTableContextAtPos } from '../tableRuntime/tableResolution';
import { isCellTextOffset } from '../shared/cursorPlacement';
import type { CellCoords } from '../tableModel/types';
import { unsanitizeRootText } from '../editorBridge/cellTextCodec';
import { createMarkdownState } from './testMarkdownState';

function contentElement(html: string): HTMLElement {
    const content = document.createElement('div');
    content.className = CLASS_CELL_CONTENT;
    content.innerHTML = html;
    return content;
}

/** Locates a text node by its content, so tests can name a caret without walking the tree. */
function textNode(root: HTMLElement, data: string): Text {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
        if ((node as Text).data === data) {
            return node as Text;
        }
        node = walker.nextNode();
    }
    throw new Error(`No text node with data ${JSON.stringify(data)}`);
}

describe('indexRenderedText', () => {
    it('flattens nested inline markup into the text a reader sees', () => {
        expect(indexRenderedText(contentElement('see <strong>the</strong> <code>docs</code>')).text).toBe(
            'see the docs'
        );
    });

    it('counts a line break as the single newline it stands for in the cell text', () => {
        // A cell newline survives its GFM row as `<br>`, and the nested editor shows it as `\n`.
        expect(indexRenderedText(contentElement('one<br>two')).text).toBe('one\ntwo');
    });

    it('skips MathML, whose text transcribes the formula rather than its source', () => {
        const index = indexRenderedText(contentElement('a <math><mi>x</mi></math> b'));
        expect(index.text).toBe('a  b');
    });

    it('contributes nothing for an image', () => {
        expect(indexRenderedText(contentElement('a<img src="x.png" alt="pic">b')).text).toBe('ab');
    });
});

describe('flatOffsetFromDomPosition', () => {
    it('offsets into a text node from where its own text begins', () => {
        const content = contentElement('see <strong>the</strong> docs');
        const index = indexRenderedText(content);

        expect(flatOffsetFromDomPosition(index, textNode(content, 'the'), 2)).toBe(6);
    });

    it('resolves a caret in an element to the start of the child it precedes', () => {
        const content = contentElement('see <strong>the</strong> docs');
        const index = indexRenderedText(content);

        expect(flatOffsetFromDomPosition(index, content, 1)).toBe(4);
    });

    it('resolves a caret past an element’s last child to the end of its text', () => {
        const content = contentElement('see <strong>the</strong> docs');
        const index = indexRenderedText(content);

        expect(flatOffsetFromDomPosition(index, content, content.childNodes.length)).toBe('see the docs'.length);
    });

    it('declines a node it never indexed', () => {
        const index = indexRenderedText(contentElement('text'));

        expect(flatOffsetFromDomPosition(index, document.createElement('div'), 0)).toBeNull();
    });
});

const CANONICAL_DOC = ['', '| H1 | H2 |', '| --- | --- |', '| **markdown** | b |', ''].join('\n');

function resolveCell(
    doc: string,
    coords: CellCoords
): { state: ReturnType<typeof createMarkdownState>; resolvedCell: ResolvedActiveCell } {
    const state = createMarkdownState(doc);
    const ctx = resolveTableContextAtPos(state, doc.indexOf('|'));
    if (!ctx) {
        throw new Error('Expected a table context');
    }
    const resolvedCell = createResolvedActiveCell({ ctx, coords });
    if (!resolvedCell) {
        throw new Error('Expected a resolved cell');
    }
    return { state, resolvedCell };
}

/**
 * The placement split into the cell's local text - the text the nested editor opens on,
 * with `<br>` back as a newline and pipes unescaped - so failures read as text and the
 * coordinate system the offset is expressed in stays visible.
 */
function placement(doc: string, coords: CellCoords, hit: RenderedCaretHit | null): string {
    const { state, resolvedCell } = resolveCell(doc, coords);
    const cellText = unsanitizeRootText(state.doc.sliceString(resolvedCell.editableFrom, resolvedCell.editableTo));
    const pos = resolveClickCursorPos(state, resolvedCell, hit);
    if (pos === undefined) {
        return '<mirrored>';
    }
    if (!isCellTextOffset(pos)) {
        throw new Error(`Expected an offset placement, got ${pos}`);
    }
    return `${cellText.slice(0, pos.localOffset)}|${cellText.slice(pos.localOffset)}`;
}

describe('resolveClickCursorPos', () => {
    const boldCell: CellCoords = { section: 'body', row: 0, col: 0 };

    it('places the caret at the clicked point inside the cell’s Markdown source', () => {
        // The reported case: clicking between "w" and "n" of a bolded "markdown".
        expect(placement(CANONICAL_DOC, boldCell, { renderedText: 'markdown', renderedOffset: 7 })).toBe(
            '**markdow|n**'
        );
    });

    it('places the caret in a plain cell one-to-one', () => {
        expect(
            placement(CANONICAL_DOC, { section: 'body', row: 0, col: 1 }, { renderedText: 'b', renderedOffset: 1 })
        ).toBe('b|');
    });

    it('places a caret across a line break, which the source stores as <br>', () => {
        const doc = ['', '| H1 |', '| --- |', '| one<br>two |', ''].join('\n');

        expect(
            placement(doc, { section: 'body', row: 0, col: 0 }, { renderedText: 'one\ntwo', renderedOffset: 5 })
        ).toBe('one\nt|wo');
    });

    it('places a caret past a pipe, which the source stores escaped', () => {
        const doc = ['', '| H1 |', '| --- |', '| a \\| b |', ''].join('\n');

        expect(placement(doc, { section: 'body', row: 0, col: 0 }, { renderedText: 'a | b', renderedOffset: 4 })).toBe(
            'a | |b'
        );
    });

    it('mirrors the main selection when the press produced no caret', () => {
        expect(placement(CANONICAL_DOC, boldCell, null)).toBe('<mirrored>');
    });

    it('mirrors the main selection when too little of the rendered text aligns', () => {
        // A cell rendered as something unrecognisable has no anchors worth placing from.
        expect(placement(CANONICAL_DOC, boldCell, { renderedText: 'qqqqqqqq', renderedOffset: 4 })).toBe('<mirrored>');
    });

    it('clamps a caret past the end of the cell text', () => {
        expect(placement(CANONICAL_DOC, boldCell, { renderedText: 'markdown', renderedOffset: 99 })).toBe(
            '**markdown**|'
        );
    });
});
