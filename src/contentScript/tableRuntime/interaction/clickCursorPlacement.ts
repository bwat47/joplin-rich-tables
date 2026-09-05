import type { EditorState } from '@codemirror/state';
import { unsanitizeRootText } from '../../shared/cellTextNormalization';
import type { InitialCursorPos } from '../../shared/cursorPlacement';
import { alignRenderedToSource, mapCaretToSource } from '../../shared/textAlignment';
import type { RenderedCaretHit } from '../../tableWidget/cellCaretHit';
import { projectCellText } from './cellTextProjection';
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

    // Projection offsets must use the decoded text that the nested editor opens.
    const rootText = state.doc.sliceString(resolvedCell.editableFrom, resolvedCell.editableTo);
    const localText = unsanitizeRootText(rootText);
    if (hit.renderedText.length === 0 && localText.length > 0) {
        // Images and skipped MathML contribute no rendered text. Their sole flattened offset
        // cannot distinguish a press before the content from one after it, so keep the established
        // mirrored-selection fallback instead of claiming every press belongs at source offset 0.
        return undefined;
    }

    // The asynchronous renderer initially displays literal cell text.
    if (hit.renderedText === localText) {
        return { localOffset: Math.max(0, Math.min(hit.renderedOffset, localText.length)) };
    }

    const projection = projectCellText(state, resolvedCell, rootText, localText);
    if (hit.renderedText === projection.text) {
        return {
            localOffset: mapCaretToSource(
                { toSource: projection.toLocal, matchedRatio: 1 },
                hit.renderedOffset,
                localText.length
            ),
        };
    }

    // Align only against visible source spans. Hidden syntax cannot become an anchor,
    // even when a URL, title or image label exactly duplicates the rendered text.
    const alignment = alignRenderedToSource(hit.renderedText, projection.text);
    if (!alignment || alignment.matchedRatio < MIN_MATCHED_RATIO) {
        return undefined;
    }
    const toLocal = Int32Array.from(alignment.toSource, (offset) => (offset < 0 ? -1 : projection.toLocal[offset]));
    return {
        localOffset: mapCaretToSource(
            { toSource: toLocal, matchedRatio: alignment.matchedRatio },
            hit.renderedOffset,
            localText.length
        ),
    };
}
