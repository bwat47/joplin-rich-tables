import type { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNodeRef } from '@lezer/common';
import { rootToLocalOffsets } from '../../shared/cellTextNormalization';
import type { ResolvedActiveCell } from '../activeCell/resolvedActiveCell';
import { clamp } from '../../shared/numberUtils';
import type { SourceSpan } from '../../shared/textAlignment';

/** Visible source characters and their offsets in the nested editor's decoded text. */
export interface CellTextProjection {
    text: string;
    toLocal: Int32Array;
    hiddenSpans: HiddenSyntaxSpan[];
}

/**
 * A run of hidden source, with the range of the construct it belongs to.
 *
 * A paired marker - the `**` of a strong span, the `](url)` of a link, the `<ins>` of an
 * explicitly closed HTML element - is a span whose owner reaches beyond it to its partner at the
 * other end. Syntax hidden whole, such as an entity or an unmatched tag, owns exactly itself and
 * so has no partner; {@link balanceSyntaxMarkers} tells the two apart by that. All offsets are in
 * the nested editor's decoded text.
 */
export interface HiddenSyntaxSpan {
    from: number;
    to: number;
    ownerFrom: number;
    ownerTo: number;
}

/**
 * Inline marks whose owning node carries the partner marker at its other end.
 *
 * `HighlightMarker` and `InsertMarker` come from Joplin's own parser extensions, so they appear
 * only while `markdown.plugin.mark` / `markdown.plugin.insert` are on. The same settings gate the
 * matching renderer plugins, so the marks exist in the tree exactly when the rendered cell hides
 * them; with a setting off the node never appears and the literal `==` stays visible on both sides.
 */
const MARK_NODES = new Set([
    'EmphasisMark',
    'StrikethroughMark',
    'CodeMark',
    'LinkMark',
    'HighlightMarker',
    'InsertMarker',
]);

/** The construct one marker of a pair belongs to; undefined for syntax that owns itself. */
function markerOwner(node: SyntaxNodeRef): SyntaxNodeRef | undefined {
    return MARK_NODES.has(node.name) ? (node.node.parent ?? undefined) : undefined;
}

/** Syntax hidden whole. `HTMLTag` is absent: tags are collected first, then paired by name. */
const HIDDEN_NODES = new Set([
    'Image',
    'Comment',
    'ProcessingInstruction',
    'EmphasisMark',
    'StrikethroughMark',
    'CodeMark',
    'LinkMark',
    'HighlightMarker',
    'InsertMarker',
    // Transformed entities are handled by alignment, never by matching their spelling.
    'Entity',
]);

/** `<`, an optional `/`, then the tag name; anything else is markup this pairing does not model. */
const HTML_TAG_NAME = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/;

/** A tag that closes itself carries no partner, whatever its name. */
const SELF_CLOSING_TAG = /\/>$/;

/** An HTML tag's source range, with the name pairing matches on. */
interface HtmlTagRef {
    from: number;
    to: number;
    /** Absent for a self-closing tag and for markup the tag pattern does not recognise. */
    name?: string;
    closing: boolean;
}

/** Reads the name and role of a tag, which the tree provides as one opaque `HTMLTag` node. */
function readHtmlTag(source: string, from: number, to: number): HtmlTagRef {
    const match = HTML_TAG_NAME.exec(source);
    const closing = match?.[1] === '/';
    if (!match || (!closing && SELF_CLOSING_TAG.test(source))) {
        return { from, to, closing: false };
    }
    return { from, to, name: match[2].toLowerCase(), closing };
}

/**
 * Owners for tags explicitly closed in the cell, keyed by the tag's own start offset.
 *
 * Only source pairs count: a `<span>` with no `</span>`, a void `<img>`, a stray `</ins>` all stay
 * unpaired and so own themselves, exactly as every HTML tag did before. HTML's implicit closing and
 * error recovery are deliberately not reproduced - a construct that never closes in the source has
 * no second marker a range could be missing. Tags left open inside a pair are dropped when it
 * closes, so `<ins>a<span>b</ins>` still pairs the `<ins>`.
 */
function pairHtmlTags(tags: readonly HtmlTagRef[]): Map<number, SourceSpan> {
    const owners = new Map<number, SourceSpan>();
    const open: HtmlTagRef[] = [];

    for (const tag of tags) {
        if (tag.name === undefined) {
            continue;
        }
        if (!tag.closing) {
            open.push(tag);
            continue;
        }
        let index = open.length - 1;
        while (index >= 0 && open[index].name !== tag.name) {
            index--;
        }
        if (index < 0) {
            continue;
        }
        const owner: SourceSpan = { from: open[index].from, to: tag.to };
        owners.set(open[index].from, owner);
        owners.set(tag.from, owner);
        open.length = index;
    }

    return owners;
}

/**
 * Projects inline syntax from the main editor into visible text. Link destinations and
 * titles are excluded as a whole, including their whitespace. Autolink URLs remain visible.
 * Unknown renderer extensions are left to the constrained alignment fallback.
 */
export function projectCellText(
    state: EditorState,
    cell: ResolvedActiveCell,
    rootText: string,
    localText: string
): CellTextProjection {
    const hidden = new Uint8Array(localText.length);
    const hiddenSpans: HiddenSyntaxSpan[] = [];
    // One offset map for the whole cell, read twice per span, instead of transforming
    // the whole cell again for each selection range.
    const localOffsets = rootToLocalOffsets(rootText);
    const toLocal = (from: number, to: number): { from: number; to: number } => ({
        from: localOffsets[clamp(from - cell.editableFrom, 0, rootText.length)],
        to: localOffsets[clamp(to - cell.editableFrom, 0, rootText.length)],
    });
    /** Hides `from`-`to`, as part of `owner` when the syntax is one marker of a pair. */
    const exclude = (from: number, to: number, owner?: { from: number; to: number }): void => {
        const span = toLocal(from, to);
        hidden.fill(1, span.from, span.to);
        const ownerSpan = owner ? toLocal(owner.from, owner.to) : span;
        hiddenSpans.push({ ...span, ownerFrom: ownerSpan.from, ownerTo: ownerSpan.to });
    };

    // Tags are held back: an opening tag's owner is only known once its partner is reached.
    const htmlTags: HtmlTagRef[] = [];

    syntaxTree(state).iterate({
        from: cell.editableFrom,
        to: cell.editableTo,
        enter(node) {
            if (node.name === 'Link') {
                // The first direct closing bracket ends the label, even with nested emphasis.
                for (let child = node.node.firstChild; child; child = child.nextSibling) {
                    if (child.name === 'LinkMark' && state.doc.sliceString(child.from, child.to) === ']') {
                        exclude(child.from, node.to, node);
                        break;
                    }
                }
            }
            if (node.name === 'Escape') {
                // Pipe escapes are already removed by the root-to-local codec.
                if (state.doc.sliceString(node.from, node.to) !== '\\|') {
                    exclude(node.from, node.from + 1);
                }
                return false;
            }
            if (node.name === 'HTMLTag') {
                const source = state.doc.sliceString(node.from, node.to);
                // Stored line breaks become real newlines in the nested editor.
                if (source !== '<br>') {
                    htmlTags.push(readHtmlTag(source, node.from, node.to));
                }
                return false;
            }
            if (HIDDEN_NODES.has(node.name)) {
                exclude(node.from, node.to, markerOwner(node));
                return false;
            }
        },
    });

    const htmlTagOwners = pairHtmlTags(htmlTags);
    for (const tag of htmlTags) {
        exclude(tag.from, tag.to, htmlTagOwners.get(tag.from));
    }

    let text = '';
    const offsets: number[] = [];
    for (let i = 0; i < localText.length; i++) {
        if (!hidden[i]) {
            text += localText[i];
            offsets.push(i);
        }
    }
    return { text, toLocal: Int32Array.from(offsets), hiddenSpans };
}

/**
 * Grows a range so it never holds one marker of a pair without the other.
 *
 * A range is read off the rendered characters it covered, so syntax around them stays outside:
 * selecting a whole bolded word yields `bold text`, not `bold text**`. But a range ending at the
 * closing `**` of `foo and **bold**` already holds the opening `**`, and selecting that alone
 * gives the nested editor Markdown that no longer parses. So an end grows past trailing syntax
 * only when the matching leading syntax is already inside the range, and likewise at the start.
 * Syntax with no partner - an entity, an image, a tag the cell never closes - owns itself and is
 * never drawn in.
 * The loops repeat because constructs nest: `***both***` closes twice over.
 */
export function balanceSyntaxMarkers(span: SourceSpan, hiddenSpans: readonly HiddenSyntaxSpan[]): SourceSpan {
    let { from, to } = span;

    for (let grew = true; grew;) {
        grew = false;
        for (const hiddenSpan of hiddenSpans) {
            const { ownerFrom, ownerTo } = hiddenSpan;
            if (
                hiddenSpan.from === to &&
                hiddenSpan.to === ownerTo &&
                ownerFrom < hiddenSpan.from &&
                ownerFrom >= from
            ) {
                to = hiddenSpan.to;
                grew = true;
            } else if (
                hiddenSpan.to === from &&
                hiddenSpan.from === ownerFrom &&
                ownerTo > hiddenSpan.to &&
                ownerTo <= to
            ) {
                from = hiddenSpan.from;
                grew = true;
            }
        }
    }

    return { from, to };
}
