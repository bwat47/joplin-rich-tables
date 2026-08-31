import type { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { toLocalSelection, unsanitizeRootText } from '../../editorBridge/cellTextCodec';
import type { InitialCursorPos } from '../../shared/cursorPlacement';
import { alignRenderedToSource, mapCaretToSource, type ExcludedSourceRange } from '../../shared/textAlignment';
import type { RenderedCaretHit } from '../../tableWidget/cellCaretHit';
import type { ResolvedActiveCell } from '../activeCell/resolvedActiveCell';

/**
 * Turns a press on a rendered cell into the caret placement the nested editor should open
 * with, so clicking inside rendered Markdown lands the caret at the corresponding place in
 * the Markdown source rather than at the start of the cell.
 */

/**
 * Alignment quality below which the placement is abandoned.
 *
 * The rendered text of a normal cell aligns almost completely; a cell that is mostly
 * formula, emoji shortcodes or HTML entities does not, and the anchors left over are too
 * sparse to place a caret from. Half is well clear of both cases: it is a floor on
 * "recognisably the same text", not a tuned threshold.
 */
const MIN_MATCHED_RATIO = 0.5;

/** Markdown syntax whose source text is absent from the rendered cell. */
const EXCLUDED_SOURCE_NODE_NAMES = new Set(['HTMLTag', 'Comment', 'ProcessingInstruction']);

/**
 * Raw-HTML syntax ranges in the coordinates of the text the nested editor opens.
 *
 * CodeMirror already distinguishes real HTML from tag-shaped inline code and autolinks, so
 * these ranges are more precise than recognising HTML-shaped strings a second time. Root-cell
 * ranges are projected through the same pipe and line-break decoding as the nested text.
 */
function excludedSourceRanges(
    state: EditorState,
    resolvedCell: ResolvedActiveCell,
    rootText: string,
    localText: string
): ExcludedSourceRange[] {
    const ranges: ExcludedSourceRange[] = [];
    syntaxTree(state).iterate({
        from: resolvedCell.editableFrom,
        to: resolvedCell.editableTo,
        enter: (node) => {
            if (!EXCLUDED_SOURCE_NODE_NAMES.has(node.name)) {
                return;
            }

            const rootFrom = Math.max(node.from, resolvedCell.editableFrom) - resolvedCell.editableFrom;
            const rootTo = Math.min(node.to, resolvedCell.editableTo) - resolvedCell.editableFrom;
            const localRange = toLocalSelection({ anchor: rootFrom, head: rootTo }, rootText);
            const from = Math.min(localRange.anchor, localRange.head);
            const to = Math.max(localRange.anchor, localRange.head);

            // `<br>` is HTML syntax in the table source but a real newline in the nested editor
            // and rendered-text index, so it must remain available as an alignment anchor.
            if (from < to && localText.slice(from, to) !== '\n') {
                ranges.push({ from, to });
            }
        },
    });
    return ranges;
}

/**
 * Resolves the caret placement for a press on `resolvedCell`.
 *
 * Returns undefined - not a placement of `'start'` - when there is nothing better to offer,
 * which leaves the open request mirroring the main editor's own selection exactly as it did
 * before. That is the established fallback for every other unplaced entry.
 *
 * The offset is measured against the cell text as it stands now. An entry that repairs the
 * table into canonical form can restripe the cell's padding underneath it, so the offset is
 * clamped where it is applied rather than trusted verbatim.
 */
export function resolveClickCursorPos(
    state: EditorState,
    resolvedCell: ResolvedActiveCell,
    hit: RenderedCaretHit | null
): InitialCursorPos | undefined {
    if (!hit) {
        return undefined;
    }

    // The nested editor opens on the unsanitized cell text, so aligning against that text
    // yields an offset in the coordinates the placement is applied in - no further mapping.
    const rootText = state.doc.sliceString(resolvedCell.editableFrom, resolvedCell.editableTo);
    const localText = unsanitizeRootText(rootText);
    if (hit.renderedText.length === 0 && localText.length > 0) {
        // Images and skipped MathML contribute no rendered text. Their sole flattened offset
        // cannot distinguish a press before the content from one after it, so keep the established
        // mirrored-selection fallback instead of claiming every press belongs at source offset 0.
        return undefined;
    }

    const alignment = alignRenderedToSource(
        hit.renderedText,
        localText,
        excludedSourceRanges(state, resolvedCell, rootText, localText)
    );
    if (!alignment || alignment.matchedRatio < MIN_MATCHED_RATIO) {
        return undefined;
    }

    return { localOffset: mapCaretToSource(alignment, hit.renderedOffset, localText.length) };
}
