import type { EditorState } from '@codemirror/state';
import { unsanitizeRootText } from '../../shared/cellTextNormalization';
import { cellTextCaret, type InitialCursorPos } from '../../shared/cursorPlacement';
import { alignRenderedToSource, mapCaretToSource, mapSelectionToSource } from '../../shared/textAlignment';
import type { RenderedCaretHit, RenderedSelectionHit } from '../../tableWidget/cellCaretHit';
import { balanceSyntaxMarkers, projectCellText, type HiddenSyntaxSpan } from './cellTextProjection';
import type { ResolvedActiveCell } from '../activeCell/resolvedActiveCell';

/**
 * Turns a press on a rendered cell into the caret placement the nested editor should open
 * with, so clicking inside rendered Markdown lands the caret at the corresponding place in
 * the Markdown source rather than at the start of the cell.
 */

/**
 * Alignment quality below which the placement is abandoned.
 *
 * The rendered text of a normal cell aligns almost completely; a cell that is mostly formula,
 * emoji shortcodes or HTML entities does not, and the anchors left over are too sparse to place
 * a caret from. Half is well clear of both cases, not a tuned threshold.
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
 * table into canonical form can rewrite the cell's padding underneath it, so the offset is
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

    const alignment = alignRenderedCellText(state, resolvedCell, hit.renderedText);
    return alignment
        ? cellTextCaret(mapCaretToSource(alignment.toLocal, hit.renderedOffset, alignment.localLength))
        : undefined;
}

/**
 * Resolves the range a rendered-text drag selected into the cell's own text.
 *
 * One alignment answers both ends, and `mapSelectionToSource` reads the span off the rendered
 * characters the drag covered, so the Markdown syntax around them is included at both ends or
 * neither, and `balanceSyntaxMarkers` keeps the range from holding half of a construct it
 * reaches into. Direction is preserved: a backward drag opens the cell with a backward selection.
 */
export function resolveRenderedSelection(
    state: EditorState,
    resolvedCell: ResolvedActiveCell,
    hit: RenderedSelectionHit
): InitialCursorPos | undefined {
    const alignment = alignRenderedCellText(state, resolvedCell, hit.renderedText);
    if (!alignment) {
        return undefined;
    }

    const backward = hit.head < hit.anchor;
    const span = balanceSyntaxMarkers(
        mapSelectionToSource(
            alignment.toLocal,
            backward ? hit.head : hit.anchor,
            backward ? hit.anchor : hit.head,
            alignment.localLength
        ),
        alignment.hiddenSpans
    );

    return {
        localSelection: backward ? { anchor: span.to, head: span.from } : { anchor: span.from, head: span.to },
    };
}

/** Where each rendered character sits in the cell's own text; -1 where it has no anchor. */
interface RenderedCellAlignment {
    toLocal: Int32Array;
    localLength: number;
    /** The cell's hidden syntax, for ranges that have to keep its markers paired. */
    hiddenSpans: HiddenSyntaxSpan[];
}

function alignRenderedCellText(
    state: EditorState,
    resolvedCell: ResolvedActiveCell,
    renderedText: string
): RenderedCellAlignment | undefined {
    // Projection offsets must use the decoded text that the nested editor opens.
    const rootText = state.doc.sliceString(resolvedCell.editableFrom, resolvedCell.editableTo);
    const localText = unsanitizeRootText(rootText);
    if (renderedText.length === 0 && localText.length > 0) {
        // Images and skipped MathML contribute no rendered text. Their sole flattened offset
        // cannot distinguish a press before the content from one after it, so keep the established
        // mirrored-selection fallback instead of claiming every press belongs at source offset 0.
        return undefined;
    }

    // The asynchronous renderer initially displays literal cell text.
    if (renderedText === localText) {
        // Nothing is hidden while the literal text stands, so no range can split a marker pair.
        return {
            toLocal: Int32Array.from({ length: localText.length }, (_, index) => index),
            localLength: localText.length,
            hiddenSpans: [],
        };
    }

    const projection = projectCellText(state, resolvedCell, rootText, localText);
    if (renderedText === projection.text) {
        return { toLocal: projection.toLocal, localLength: localText.length, hiddenSpans: projection.hiddenSpans };
    }

    // Align only against visible source spans. Hidden syntax cannot become an anchor,
    // even when a URL, title or image label exactly duplicates the rendered text.
    const alignment = alignRenderedToSource(renderedText, projection.text);
    if (!alignment || alignment.matchedRatio < MIN_MATCHED_RATIO) {
        return undefined;
    }

    return {
        toLocal: Int32Array.from(alignment.toSource, (offset) => (offset < 0 ? -1 : projection.toLocal[offset])),
        localLength: localText.length,
        hiddenSpans: projection.hiddenSpans,
    };
}
