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
 * A paired marker - the `**` of a strong span, the `](url)` of a link - is a span whose owner
 * reaches beyond it to its partner at the other end. Syntax hidden whole, such as an entity or
 * an HTML tag, owns exactly itself and so has no partner; {@link balanceSyntaxMarkers} tells the
 * two apart by that.  All offsets are in the nested editor's decoded text.
 */
export interface HiddenSyntaxSpan {
    from: number;
    to: number;
    ownerFrom: number;
    ownerTo: number;
}

/** Inline marks whose owning node carries the partner marker at its other end. */
const MARK_NODES = new Set(['EmphasisMark', 'StrikethroughMark', 'CodeMark', 'LinkMark']);

/** The construct one marker of a pair belongs to; undefined for syntax that owns itself. */
function markerOwner(node: SyntaxNodeRef): SyntaxNodeRef | undefined {
    return MARK_NODES.has(node.name) ? (node.node.parent ?? undefined) : undefined;
}

const HIDDEN_NODES = new Set([
    'Image',
    'HTMLTag',
    'Comment',
    'ProcessingInstruction',
    'EmphasisMark',
    'StrikethroughMark',
    'CodeMark',
    'LinkMark',
    // Transformed entities are handled by alignment, never by matching their spelling.
    'Entity',
]);

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
            if (HIDDEN_NODES.has(node.name)) {
                // Stored line breaks become real newlines in the nested editor.
                if (node.name !== 'HTMLTag' || state.doc.sliceString(node.from, node.to) !== '<br>') {
                    exclude(node.from, node.to, markerOwner(node));
                }
                return false;
            }
        },
    });

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
 * Syntax with no partner - an entity, an HTML tag, an image - owns itself and is never drawn in.
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
