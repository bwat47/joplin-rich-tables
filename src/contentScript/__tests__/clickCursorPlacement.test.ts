/** @vitest-environment jsdom */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { CLASS_CELL_CONTENT } from '../shared/tableDomClasses';
import {
    indexRenderedText,
    flatOffsetFromDomPosition,
    readRenderedSelectionHit,
    type RenderedCaretHit,
    type RenderedSelectionHit,
} from '../tableWidget/cellCaretHit';
import { resolveClickCursorPos, resolveRenderedSelection } from '../tableRuntime/interaction/clickCursorPlacement';
import { createResolvedActiveCell, type ResolvedActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import { resolveTableContextAtPos } from '../tableRuntime/tableResolution';
import { isCellTextOffset } from '../shared/cursorPlacement';
import type { CellCoords } from '../tableModel/types';
import { unsanitizeRootText } from '../shared/cellTextNormalization';
import { handleWidgetPress } from '../tableWidget/tableWidgetInteractions';
import { getPendingOpenCellRequest } from '../tableRuntime/openCellRequest';
import { resolveInitialLocalSelection } from '../nestedEditor/nestedEditorSelection';
import { createInteractiveTableHarness } from './interactiveTableTestHarness';
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

/** A cell in the document, so a selection can genuinely run past it into the page. */
function mountedCell(html: string): HTMLElement {
    const cell = document.createElement('td');
    cell.appendChild(contentElement(html));
    const row = document.createElement('tr');
    row.appendChild(cell);
    const body = document.createElement('tbody');
    body.appendChild(row);
    const table = document.createElement('table');
    table.appendChild(body);
    document.body.appendChild(table);
    return cell;
}

/** Text outside the table, placed either side of it in document order. */
function pageText(data: string, where: 'before' | 'after'): Text {
    const paragraph = document.createElement('p');
    paragraph.textContent = data;
    document.body[where === 'before' ? 'prepend' : 'append'](paragraph);
    return paragraph.firstChild as Text;
}

function select(anchorNode: Node, anchorOffset: number, focusNode: Node, focusOffset: number): void {
    const selection = document.getSelection();
    if (!selection) {
        throw new Error('Expected the test document to have a selection');
    }
    selection.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
}

describe('readRenderedSelectionHit', () => {
    afterEach(() => {
        document.getSelection()?.removeAllRanges();
        document.body.replaceChildren();
    });

    it('clamps an endpoint the drag carried out of the cell to the end it left by', () => {
        const cell = mountedCell('see <strong>the</strong> docs');
        select(textNode(cell, 'the'), 1, pageText('below the table', 'after'), 5);

        expect(readRenderedSelectionHit(cell)).toEqual({ renderedText: 'see the docs', anchor: 5, head: 12 });
    });

    it('clamps a backward drag out of the cell to its start, keeping the direction', () => {
        const cell = mountedCell('see <strong>the</strong> docs');
        select(textNode(cell, 'the'), 1, pageText('above the table', 'before'), 5);

        expect(readRenderedSelectionHit(cell)).toEqual({ renderedText: 'see the docs', anchor: 5, head: 0 });
    });

    it('declines a selection with neither endpoint in the cell', () => {
        const cell = mountedCell('see <strong>the</strong> docs');
        select(pageText('above the table', 'before'), 0, pageText('below the table', 'after'), 5);

        expect(readRenderedSelectionHit(cell)).toBeNull();
    });

    it('declines an endpoint inside a formula, whose text is not its source', () => {
        const cell = mountedCell('a <math><mi>x</mi></math> b');
        select(textNode(cell, 'a '), 0, textNode(cell, 'x'), 1);

        expect(readRenderedSelectionHit(cell)).toBeNull();
    });

    it('declines a collapsed selection, which is a caret rather than a range', () => {
        const cell = mountedCell('see <strong>the</strong> docs');
        select(textNode(cell, 'the'), 1, textNode(cell, 'the'), 1);

        expect(readRenderedSelectionHit(cell)).toBeNull();
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

/** As {@link placement}, with the mapped range bracketed rather than a caret marked. */
function rangePlacement(doc: string, coords: CellCoords, hit: RenderedSelectionHit): string {
    const { state, resolvedCell } = resolveCell(doc, coords);
    const cellText = unsanitizeRootText(state.doc.sliceString(resolvedCell.editableFrom, resolvedCell.editableTo));
    const pos = resolveRenderedSelection(state, resolvedCell, hit);
    if (pos === undefined) {
        return '<mirrored>';
    }
    if (typeof pos !== 'object' || !('localSelection' in pos)) {
        throw new Error(`Expected a range placement, got ${JSON.stringify(pos)}`);
    }
    const { anchor, head } = pos.localSelection;
    const [from, to] = anchor <= head ? [anchor, head] : [head, anchor];
    return `${cellText.slice(0, from)}[${cellText.slice(from, to)}]${cellText.slice(to)}`;
}

/** A one-cell table whose only body cell holds `source`. */
function cellDoc(source: string): string {
    return ['', '| H1 |', '| --- |', `| ${source} |`, ''].join('\n');
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

    it('places repeated text on the correct side of an emphasis boundary', () => {
        const doc = ['', '| H1 |', '| --- |', '| a**aa** |', ''].join('\n');

        expect(placement(doc, { section: 'body', row: 0, col: 0 }, { renderedText: 'aaa', renderedOffset: 1 })).toBe(
            'a**|aa**'
        );
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

    it('excludes raw-HTML tags when aligning their visible text', () => {
        const doc = ['', '| H1 |', '| --- |', '| <code>code</code> |', ''].join('\n');

        expect(placement(doc, { section: 'body', row: 0, col: 0 }, { renderedText: 'code', renderedOffset: 2 })).toBe(
            '<code>co|de</code>'
        );
    });

    it('excludes raw-HTML attributes when aligning identical visible text', () => {
        const doc = ['', '| H1 |', '| --- |', '| <span title="hello">hello</span> |', ''].join('\n');

        expect(placement(doc, { section: 'body', row: 0, col: 0 }, { renderedText: 'hello', renderedOffset: 2 })).toBe(
            '<span title="hello">he|llo</span>'
        );
    });

    it('excludes HTML comments when aligning later visible text', () => {
        const doc = ['', '| H1 |', '| --- |', '| <!--hello-->hello |', ''].join('\n');

        expect(placement(doc, { section: 'body', row: 0, col: 0 }, { renderedText: 'hello', renderedOffset: 2 })).toBe(
            '<!--hello-->he|llo'
        );
    });

    it('excludes HTML processing instructions when aligning later visible text', () => {
        const doc = ['', '| H1 |', '| --- |', '| <?pi hello?>hello |', ''].join('\n');

        expect(placement(doc, { section: 'body', row: 0, col: 0 }, { renderedText: 'hello', renderedOffset: 2 })).toBe(
            '<?pi hello?>he|llo'
        );
    });

    it('keeps tag-shaped inline code and autolinks available to alignment', () => {
        const inlineCodeDoc = ['', '| H1 |', '| --- |', '| `<code>code</code>` |', ''].join('\n');
        const autolinkDoc = ['', '| H1 |', '| --- |', '| <https://example.com> |', ''].join('\n');

        expect(
            placement(
                inlineCodeDoc,
                { section: 'body', row: 0, col: 0 },
                {
                    renderedText: '<code>code</code>',
                    renderedOffset: 8,
                }
            )
        ).toBe('`<code>co|de</code>`');
        expect(
            placement(
                autolinkDoc,
                { section: 'body', row: 0, col: 0 },
                {
                    renderedText: 'https://example.com',
                    renderedOffset: 8,
                }
            )
        ).toBe('<https://|example.com>');
    });

    it('maps excluded HTML ranges through an earlier escaped pipe', () => {
        const doc = ['', '| H1 |', '| --- |', '| a \\| <code>code</code> |', ''].join('\n');

        expect(
            placement(doc, { section: 'body', row: 0, col: 0 }, { renderedText: 'a | code', renderedOffset: 6 })
        ).toBe('a | <code>co|de</code>');
    });

    it('maps excluded HTML ranges through an earlier line break', () => {
        const doc = ['', '| H1 |', '| --- |', '| one<br><code>code</code> |', ''].join('\n');

        expect(
            placement(doc, { section: 'body', row: 0, col: 0 }, { renderedText: 'one\ncode', renderedOffset: 6 })
        ).toBe('one\n<code>co|de</code>');
    });

    it('mirrors the main selection when the press produced no caret', () => {
        expect(placement(CANONICAL_DOC, boldCell, null)).toBe('<mirrored>');
    });

    it('mirrors the main selection when too little of the rendered text aligns', () => {
        // A cell rendered as something unrecognisable has no anchors worth placing from.
        expect(placement(CANONICAL_DOC, boldCell, { renderedText: 'qqqqqqqq', renderedOffset: 4 })).toBe('<mirrored>');
    });

    it('mirrors the main selection when non-empty source renders no indexable text', () => {
        const doc = ['', '| H1 |', '| --- |', '| ![alt](resource) |', ''].join('\n');

        expect(placement(doc, { section: 'body', row: 0, col: 0 }, { renderedText: '', renderedOffset: 0 })).toBe(
            '<mirrored>'
        );
    });

    it('places the only possible caret in a genuinely empty cell', () => {
        const doc = ['', '| H1 |', '| --- |', '|  |', ''].join('\n');

        expect(placement(doc, { section: 'body', row: 0, col: 0 }, { renderedText: '', renderedOffset: 0 })).toBe('|');
    });

    it('clamps a caret past the end of the cell text', () => {
        expect(placement(CANONICAL_DOC, boldCell, { renderedText: 'markdown', renderedOffset: 99 })).toBe(
            '**markdown**|'
        );
    });
});

describe('syntax-aware click placement', () => {
    it.each([
        ['[a](url "a b") **b**', 'a b', 1, '[a](url "a b")| **b**'],
        ['![hello world](img)hello **world**', 'hello world', 3, '![hello world](img)hel|lo **world**'],
        ['[a](url "a b") **b** &amp; c', 'a b & c', 2, '[a](url "a b") **|b** &amp; c'],
        ['[**hello**](hello "hello")', 'hello', 2, '[**he|llo**](hello "hello")'],
        ['[a](destination "many spaces") b', 'a b', 2, '[a](destination "many spaces") |b'],
        ['~~strike~~ and `code`', 'strike and code', 12, '~~strike~~ and `c|ode`'],
        ['a \\| [**hello**](url "hello")', 'a | hello', 6, 'a | [**he|llo**](url "hello")'],
        ['one<br>[hello](url "hello")', 'one\nhello', 6, 'one\n[he|llo](url "hello")'],
        ['**raw**', '**raw**', 4, '**ra|w**'],
    ])('maps %s through visible source spans', (source, renderedText, renderedOffset, expected) => {
        const doc = ['', '| H1 |', '| --- |', `| ${source} |`, ''].join('\n');
        expect(placement(doc, { section: 'body', row: 0, col: 0 }, { renderedText, renderedOffset })).toBe(expected);
    });

    it('directly maps long formatted cells beyond the alignment budget', () => {
        const word = 'a'.repeat(1500);
        const doc = ['', '| H1 |', '| --- |', `| **${word}** |`, ''].join('\n');
        const { state, resolvedCell } = resolveCell(doc, { section: 'body', row: 0, col: 0 });
        expect(resolveClickCursorPos(state, resolvedCell, { renderedText: word, renderedOffset: 1200 })).toEqual({
            localOffset: 1202,
        });
    });

    it('carries a DOM caret through mouse entry into the initial nested selection', () => {
        const { view, cells } = createInteractiveTableHarness({ doc: CANONICAL_DOC.trim() });
        const content = contentElement('<strong>markdown</strong>');
        cells.body0.querySelector = () => content;
        const range = document.createRange();
        range.setStart(textNode(content, 'markdown'), 7);
        Object.defineProperty(cells.body0, 'ownerDocument', {
            value: {
                caretRangeFromPoint: vi.fn(() => range),
            },
        });
        const event = {
            type: 'mousedown',
            button: 0,
            clientX: 20,
            clientY: 10,
            target: cells.body0,
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
        } as unknown as MouseEvent;
        expect(handleWidgetPress(view, event)).toBe('consume');
        const request = getPendingOpenCellRequest(view.state);
        expect(request?.initialCursorPos).toEqual({ localOffset: 9 });
        expect(resolveInitialLocalSelection({ anchor: 0, head: 0 }, '**markdown**', request?.initialCursorPos)).toEqual(
            { anchor: 9, head: 9 }
        );
    });
});

describe('rendered range mapping', () => {
    const cell: CellCoords = { section: 'body', row: 0, col: 0 };

    it('maps a backward range through the alignment fallback', () => {
        const doc = ['', '| H1 |', '| --- |', '| **hello** &amp; world |', ''].join('\n');
        const { state, resolvedCell } = resolveCell(doc, cell);
        expect(
            resolveRenderedSelection(state, resolvedCell, { renderedText: 'hello & world', anchor: 11, head: 2 })
        ).toEqual({ localSelection: { anchor: 19, head: 4 } });
    });

    it('leaves the delimiters of a fully selected formatted word outside both ends', () => {
        expect(
            rangePlacement(cellDoc('test **bold text** aaa'), cell, {
                renderedText: 'test bold text aaa',
                anchor: 5,
                head: 14,
            })
        ).toBe('test **[bold text]** aaa');
    });

    it('maps the same range the same way when it was dragged backwards', () => {
        expect(
            rangePlacement(cellDoc('test **bold text** aaa'), cell, {
                renderedText: 'test bold text aaa',
                anchor: 14,
                head: 5,
            })
        ).toBe('test **[bold text]** aaa');
    });

    it('takes the syntax a range spans over rather than the syntax around it', () => {
        expect(
            rangePlacement(cellDoc('test **bold text** aaa'), cell, {
                renderedText: 'test bold text aaa',
                anchor: 2,
                head: 12,
            })
        ).toBe('te[st **bold te]xt** aaa');
    });

    it('selects a link’s label without its target', () => {
        expect(
            rangePlacement(cellDoc('a [link](http://x) b'), cell, { renderedText: 'a link b', anchor: 2, head: 6 })
        ).toBe('a [[link]](http://x) b');
    });

    it('closes a construct whose opening syntax the range already holds', () => {
        expect(
            rangePlacement(cellDoc('foo and **nested markdown** and more'), cell, {
                renderedText: 'foo and nested markdown and more',
                anchor: 0,
                head: 23,
            })
        ).toBe('[foo and **nested markdown**] and more');
    });

    it('opens a construct whose closing syntax the range already holds', () => {
        expect(
            rangePlacement(cellDoc('foo and **nested markdown** and more'), cell, {
                renderedText: 'foo and nested markdown and more',
                anchor: 8,
                head: 32,
            })
        ).toBe('foo and [**nested markdown** and more]');
    });

    it('leaves syntax that has no partner outside a range that stops beside it', () => {
        // The entity renders one character the range did not cover; nothing pairs it inwards.
        expect(rangePlacement(cellDoc('a &amp; b'), cell, { renderedText: 'a & b', anchor: 0, head: 2 })).toBe(
            '[a ]&amp; b'
        );
    });

    it('closes every construct of a nested pair', () => {
        expect(
            rangePlacement(cellDoc('foo ***both*** bar'), cell, { renderedText: 'foo both bar', anchor: 0, head: 8 })
        ).toBe('[foo ***both***] bar');
    });

    it('pairs markers through the alignment fallback', () => {
        // Entities force the fallback, and the range still ends on the far side of the `**`.
        const source = 'x &amp; y and **bold**<br>more';
        expect(
            rangePlacement(cellDoc(source), cell, { renderedText: 'x & y and bold\nmore', anchor: 0, head: 14 })
        ).toBe('[x &amp; y and **bold**]\nmore');
    });

    it('takes the whole cell text when the range covers every rendered character', () => {
        expect(rangePlacement(cellDoc('**bold**'), cell, { renderedText: 'bold', anchor: 0, head: 4 })).toBe(
            '[**bold**]'
        );
    });
});
