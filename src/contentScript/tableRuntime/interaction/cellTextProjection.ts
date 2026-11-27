import { syntaxTree } from '@codemirror/language';
import type { EditorState, Text } from '@codemirror/state';
import type { SyntaxNode, SyntaxNodeRef } from '@lezer/common';

import { clamp } from '../../shared/numberUtils';
import type { SourceSpan } from '../../shared/textAlignment';
import { rootToLocalOffsets } from '../../tableModel/cellTextNormalization';
import type { ResolvedActiveCell } from '../../tableState/resolvedActiveCell';

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

/** The first direct closing bracket of a link, which ends its label even with nested emphasis. */
function findLinkLabelClose(link: SyntaxNode, doc: Text): SyntaxNode | null {
    for (let child = link.firstChild; child; child = child.nextSibling) {
        if (child.name === 'LinkMark' && doc.sliceString(child.from, child.to) === ']') {
            return child;
        }
    }
    return null;
}

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

/**
 * `<`, an optional `/`, then the tag name, matching the name and spacing the Markdown grammar
 * itself accepts (`[a-zA-Z][\w-]*`, with optional whitespace after the `<` or the `/`). Names are
 * read the way the tag was hidden, so `<foo_bar>` cannot be truncated into a false match for
 * `</foo_baz>`. Anything else - a doctype, CDATA - fails to match and owns itself.
 */
const HTML_TAG_NAME = /^<(\/)?\s*([a-zA-Z][\w-]*)/;

/**
 * A tag that closes itself carries no partner, whatever its name. The grammar allows whitespace
 * between the `/` and the `>`, so `<x-tag/ >` is self-closing too.
 *
 * An unquoted attribute value ending in a slash - `<a href=x/>` - trips this as well, where the
 * grammar reads the slash as part of the value. That leaves the tag unpaired, which is the
 * behaviour every tag had before pairing existed; telling the two apart needs attribute parsing.
 */
const SELF_CLOSING_TAG = /\/\s*>$/;

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
    const closing = match?.[1] !== undefined;
    if (!match || (!closing && SELF_CLOSING_TAG.test(source))) {
        return { from, to, closing: false };
    }
    return { from, to, name: match[2]!.toLowerCase(), closing };
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
    const open: { from: number; name: string }[] = [];
    // How many of each name the stack holds, so a closer with no opener costs no search at all.
    // Without it a cell of unmatched closing tags walks the whole stack for each one.
    const openCounts = new Map<string, number>();

    for (const tag of tags) {
        const name = tag.name;
        if (name === undefined) {
            continue;
        }
        if (!tag.closing) {
            open.push({ from: tag.from, name });
            openCounts.set(name, (openCounts.get(name) ?? 0) + 1);
            continue;
        }
        if (!openCounts.get(name)) {
            continue;
        }
        // The count guarantees a match, and every entry the search passes is dropped with it,
        // so pairing a whole cell stays linear in the number of tags it holds.
        let index = open.length - 1;
        while (open[index]!.name !== name) {
            index--;
        }
        for (let i = index; i < open.length; i++) {
            const openTag = open[i]!;
            openCounts.set(openTag.name, (openCounts.get(openTag.name) ?? 0) - 1);
        }
        const opener = open[index]!;
        const owner: SourceSpan = { from: opener.from, to: tag.to };
        owners.set(opener.from, owner);
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
        from: localOffsets[clamp(from - cell.editableFrom, 0, rootText.length)]!,
        to: localOffsets[clamp(to - cell.editableFrom, 0, rootText.length)]!,
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
            switch (node.name) {
                case 'Link': {
                    // Descend into the link: its marks and nested syntax are handled as children.
                    const labelClose = findLinkLabelClose(node.node, state.doc);
                    if (labelClose) {
                        exclude(labelClose.from, node.to, node);
                    }
                    return undefined;
                }
                case 'Escape':
                    // Pipe escapes are already removed by the root-to-local codec.
                    if (state.doc.sliceString(node.from, node.to) !== '\\|') {
                        exclude(node.from, node.from + 1);
                    }
                    return false;
                case 'HTMLTag': {
                    const source = state.doc.sliceString(node.from, node.to);
                    // Stored line breaks become real newlines in the nested editor.
                    if (source !== '<br>') {
                        htmlTags.push(readHtmlTag(source, node.from, node.to));
                    }
                    return false;
                }
                default:
                    if (HIDDEN_NODES.has(node.name)) {
                        exclude(node.from, node.to, markerOwner(node));
                        return false;
                    }
                    return undefined;
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

/** A paired construct and the visible content between its opening and closing syntax. */
interface PairedConstruct {
    ownerFrom: number;
    ownerTo: number;
    contentFrom: number;
    contentTo: number;
}

/**
 * Groups paired markers by construct. A construct can hide several runs at one end - a link's
 * `](url)` and its own `)` both end at the link's end - so its content starts after the furthest
 * opening run and stops before the earliest closing run.
 */
function pairedConstructs(hiddenSpans: readonly HiddenSyntaxSpan[]): PairedConstruct[] {
    const constructs = new Map<string, PairedConstruct>();
    for (const { from, to, ownerFrom, ownerTo } of hiddenSpans) {
        const opens = from === ownerFrom && to < ownerTo;
        const closes = to === ownerTo && from > ownerFrom;
        if (!opens && !closes) {
            continue;
        }
        const key = `${ownerFrom}:${ownerTo}`;
        const construct = constructs.get(key) ?? { ownerFrom, ownerTo, contentFrom: ownerFrom, contentTo: ownerTo };
        if (opens) {
            construct.contentFrom = Math.max(construct.contentFrom, to);
        } else {
            construct.contentTo = Math.min(construct.contentTo, from);
        }
        constructs.set(key, construct);
    }
    return [...constructs.values()].filter(({ contentFrom, contentTo }) => contentFrom < contentTo);
}

/**
 * Grows a range to the full source of every construct whose visible content it covers whole.
 *
 * This matches the rule Joplin's own editor applies to rendered-Markdown selections: selecting
 * `bold` in `this is **bold**` yields `**bold**`, and so does `is bold` (`is **bold**`), so a range
 * never holds one marker of a pair without the other. A range that covers only part of a
 * construct's content - `te[st **bold te]xt**` - is left as the characters it covered.
 * Syntax with no partner - an entity, an image, a tag the cell never closes - owns itself and is
 * never drawn in. An empty range stays a caret.
 * The loop repeats because constructs nest: `***both***` and `**[link](url)**` close twice over.
 */
export function balanceSyntaxMarkers(span: SourceSpan, hiddenSpans: readonly HiddenSyntaxSpan[]): SourceSpan {
    let { from, to } = span;
    if (from === to) {
        return span;
    }

    const constructs = pairedConstructs(hiddenSpans);
    for (let grew = true; grew;) {
        grew = false;
        for (const construct of constructs) {
            const covered = from <= construct.contentFrom && to >= construct.contentTo;
            if (covered && (from > construct.ownerFrom || to < construct.ownerTo)) {
                from = Math.min(from, construct.ownerFrom);
                to = Math.max(to, construct.ownerTo);
                grew = true;
            }
        }
    }

    return { from, to };
}
