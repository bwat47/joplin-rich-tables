import type { EditorState } from '@codemirror/state';
import { unsanitizeRootText } from '../../editorBridge/cellTextCodec';
import type { InitialCursorPos } from '../../shared/cursorPlacement';
import { alignRenderedToSource, mapCaretToSource } from '../../shared/textAlignment';
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
    const localText = unsanitizeRootText(state.doc.sliceString(resolvedCell.editableFrom, resolvedCell.editableTo));

    const alignment = alignRenderedToSource(hit.renderedText, localText);
    if (!alignment || alignment.matchedRatio < MIN_MATCHED_RATIO) {
        return undefined;
    }

    return { localOffset: mapCaretToSource(alignment, hit.renderedOffset, localText.length) };
}
