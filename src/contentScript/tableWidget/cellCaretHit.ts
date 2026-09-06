import { CLASS_CELL_CONTENT } from '../shared/tableDomClasses';

/**
 * Turns a point inside a rendered cell into an offset in that cell's rendered text.
 *
 * This is the half of click-to-caret placement that owns widget DOM; converting the
 * result back into a Markdown offset belongs to the runtime, which has the document.
 */

/** A press inside a rendered cell, expressed against the text the reader can see. */
export interface RenderedCaretHit {
    /** Flattened text of the cell's rendered content, as {@link indexRenderedText} defines it. */
    renderedText: string;
    /** Caret offset within `renderedText`. */
    renderedOffset: number;
}

/** Where a node's text sits in the flattened rendered text. */
interface TextSpan {
    start: number;
    end: number;
}

export interface RenderedTextIndex {
    text: string;
    spans: Map<Node, TextSpan>;
}

/**
 * Elements whose descendant text bears no useful resemblance to the Markdown that produced
 * it. KaTeX output is rewritten into MathML during post-processing, so its text is a
 * transcription of the formula rather than of the `$...$` source. Skipping the subtree
 * leaves the formula as one unmatched gap the alignment can step over, instead of a run of
 * characters that align convincingly to the wrong places.
 */
const OPAQUE_LOCAL_NAMES = new Set(['math']);

const LINE_BREAK_LOCAL_NAME = 'br';

/**
 * Flattens a rendered cell's text and records where each node's text landed.
 *
 * `<br>` counts as a single character because that is what it is in the cell's own text: a
 * newline has to survive a GFM table row as `<br>`, and the nested editor shows it as `\n`
 * again. Counting it as one keeps the flattened text directly comparable to the text the
 * editor will open with.
 *
 * Spans are recorded for every node visited. Descendants of opaque subtrees are not visited,
 * so a caret reported inside one declines placement and uses the established fallback.
 */
export function indexRenderedText(root: HTMLElement): RenderedTextIndex {
    const spans = new Map<Node, TextSpan>();
    let text = '';

    const visit = (node: Node): void => {
        const start = text.length;

        if (node.nodeType === Node.TEXT_NODE) {
            text += (node as Text).data;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as Element;
            if (element.localName === LINE_BREAK_LOCAL_NAME) {
                text += '\n';
            } else if (!OPAQUE_LOCAL_NAMES.has(element.localName)) {
                for (const child of Array.from(element.childNodes)) {
                    visit(child);
                }
            }
        }

        spans.set(node, { start, end: text.length });
    };

    for (const child of Array.from(root.childNodes)) {
        visit(child);
    }
    spans.set(root, { start: 0, end: text.length });

    return { text, spans };
}

/**
 * Converts a DOM caret position into an offset in the flattened text.
 *
 * A caret in a text node offsets into its characters; a caret in an element offsets into
 * its child list, and resolves to the start of the child it precedes. Returns null for a
 * node the index never saw, which means the caret was not inside the cell content.
 */
export function flatOffsetFromDomPosition(index: RenderedTextIndex, node: Node, offset: number): number | null {
    const span = index.spans.get(node);
    if (!span) {
        return null;
    }

    if (node.nodeType === Node.TEXT_NODE) {
        const data = (node as Text).data;
        return span.start + Math.min(Math.max(offset, 0), data.length);
    }

    const children = node.childNodes;
    if (offset <= 0) {
        return span.start;
    }
    if (offset >= children.length) {
        return span.end;
    }

    return index.spans.get(children[offset])?.start ?? span.end;
}

interface CaretDomPosition {
    node: Node;
    offset: number;
}

/**
 * A caret hit together with the DOM position it resolved to.
 *
 * Mapping a hit back into Markdown needs only the flattened offset; drawing the range the
 * press is making needs the DOM endpoint, and reading it here costs nothing because the hit
 * test produced it.
 */
export interface RenderedCaretDomHit extends RenderedCaretHit, CaretDomPosition {}

/**
 * Document APIs for hit-testing a caret, neither of which is in every engine's lib types.
 *
 * `caretRangeFromPoint` is the Chromium and WebKit spelling, which covers Joplin desktop and
 * both mobile webviews; `caretPositionFromPoint` is the standard one, which Firefox ships.
 */
interface CaretHitTestDocument {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
}

function caretFromPoint(doc: Document, clientX: number, clientY: number): CaretDomPosition | null {
    const hitTest = doc as Document & CaretHitTestDocument;

    const range = hitTest.caretRangeFromPoint?.(clientX, clientY);
    if (range) {
        return { node: range.startContainer, offset: range.startOffset };
    }

    const position = hitTest.caretPositionFromPoint?.(clientX, clientY);
    return position ? { node: position.offsetNode, offset: position.offset } : null;
}

/**
 * Offset for a press that missed the content box, which is what clicking a cell's padding
 * produces. Past the content's end in reading order means the end of the text and before its
 * start means the beginning; anything else has no obvious answer and declines.
 */
function offsetOutsideContent(
    content: HTMLElement,
    textLength: number,
    clientX: number,
    clientY: number
): number | null {
    const rect = content.getBoundingClientRect();

    if (clientY > rect.bottom || (clientY >= rect.top && clientX > rect.right)) {
        return textLength;
    }
    if (clientY < rect.top || clientX < rect.left) {
        return 0;
    }

    return null;
}

/**
 * Reads the caret a press at (`clientX`, `clientY`) implies within `cell`'s rendered content.
 *
 * Returns null when the cell has no rendered content wrapper or the press cannot be
 * resolved against it, which callers treat as "no placement to offer".
 */
export function readRenderedCaretHit(cell: HTMLElement, clientX: number, clientY: number): RenderedCaretDomHit | null {
    const content = cell.querySelector(`:scope > .${CLASS_CELL_CONTENT}`) as HTMLElement | null;
    if (!content) {
        return null;
    }

    const index = indexRenderedText(content);
    const caret = caretFromPoint(cell.ownerDocument, clientX, clientY);
    if (caret && content.contains(caret.node)) {
        const renderedOffset = flatOffsetFromDomPosition(index, caret.node, caret.offset);
        return renderedOffset === null ? null : { renderedText: index.text, renderedOffset, ...caret };
    }

    const renderedOffset = offsetOutsideContent(content, index.text.length, clientX, clientY);
    if (renderedOffset === null) {
        return null;
    }

    // A press that missed the content box has no DOM caret of its own, so it takes the
    // matching edge of the content element.
    return {
        renderedText: index.text,
        renderedOffset,
        node: content,
        offset: renderedOffset === 0 ? 0 : content.childNodes.length,
    };
}

/**
 * Paints the range a press is drawing across one rendered cell.
 *
 * A rendered-cell press is consumed rather than left to the browser, so there is no native
 * text-selection drag to draw this: a native drag keeps auto-scrolling the outer editor after
 * the gesture becomes a cell rectangle, and nothing can cancel it once it has started.
 *
 * The endpoints are the ones the hit test read, so a re-render between the press and now
 * leaves them outside the cell rather than pointing at the wrong text.
 */
export function setRenderedTextSelection(
    cell: HTMLElement,
    anchor: RenderedCaretDomHit,
    head: RenderedCaretDomHit
): void {
    if (!cell.contains(anchor.node) || !cell.contains(head.node)) {
        return;
    }

    cell.ownerDocument.getSelection()?.setBaseAndExtent(anchor.node, anchor.offset, head.node, head.offset);
}

/** A native selection anchored in one rendered cell. */
export interface RenderedSelectionHit {
    renderedText: string;
    anchor: number;
    head: number;
}

/**
 * Offset for an endpoint the index has no entry for.
 *
 * An endpoint outside the content is where the drag left the cell, so it clamps to that end of
 * the rendered text: dragging out of the table selects to the end of the cell instead of losing
 * the range.
 */
function offsetForEscapedEndpoint(content: HTMLElement, index: RenderedTextIndex, node: Node): number | null {
    if (content.contains(node)) {
        return null;
    }

    const precedesContent = (content.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
    return precedesContent ? 0 : index.text.length;
}

/**
 * Reads both endpoints before opening the editor replaces the selected DOM.
 *
 * At least one endpoint must resolve inside the cell, so a selection that has nothing to do with
 * this cell is never read as one covering all of it.
 */
export function readRenderedSelectionHit(cell: HTMLElement): RenderedSelectionHit | null {
    const content = cell.querySelector(`:scope > .${CLASS_CELL_CONTENT}`) as HTMLElement | null;
    const selection = cell.ownerDocument.getSelection();
    if (!content || !selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode) {
        return null;
    }

    const index = indexRenderedText(content);
    const anchorInside = flatOffsetFromDomPosition(index, selection.anchorNode, selection.anchorOffset);
    const headInside = flatOffsetFromDomPosition(index, selection.focusNode, selection.focusOffset);
    if (anchorInside === null && headInside === null) {
        return null;
    }

    const anchor = anchorInside ?? offsetForEscapedEndpoint(content, index, selection.anchorNode);
    const head = headInside ?? offsetForEscapedEndpoint(content, index, selection.focusNode);
    return anchor === null || head === null ? null : { renderedText: index.text, anchor, head };
}
