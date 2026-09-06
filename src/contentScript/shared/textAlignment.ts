/**
 * Bounded character alignment for rendered text that differs from its visible-source
 * projection. The caller removes hidden Markdown before alignment; matching raw source
 * alone cannot distinguish visible text from identical link titles or image descriptions.
 *
 * One forward scan walks both strings together, resynchronising within a small window wherever
 * they diverge. Renderer substitutions are local - an entity, an em dash, an emoji standing in
 * for its shortcode - so an anchor close by is enough to recover, and the characters between
 * anchors are left unmatched for {@link mapCaretToSource} to step over.
 *
 * The scan never backtracks, so one anchor taken in the wrong place strands the rest of the
 * cell. That is why the window is small: a wider one reaches further past a long run of hidden
 * source, but also reaches coincidental matches that a near one would have won. The stranding
 * is self-limiting rather than silent - it collapses the matched ratio, and the caller declines
 * placement below its own threshold - so a poisoned scan falls back to mirroring the main
 * editor's selection rather than placing a confidently wrong caret.
 */

/** Maximum input length for alignment; direct mappings bypass this limit. */
const MAX_ALIGNMENT_LENGTH = 1000;

/**
 * How far past the current source position a diverged scan looks for its next anchor.
 *
 * Wide enough for the substitutions a renderer actually makes, and for the syntax the projection
 * could not identify; narrow enough that a character with no true counterpart cannot reach a
 * coincidental match further down the cell.
 */
const RESYNC_WINDOW = 24;

/** How many characters must agree for a candidate anchor to beat a nearer coincidence. */
const RESYNC_RUN = 3;

export interface TextAlignment {
    /** Source index each rendered index maps to, or -1 where the character did not align. */
    readonly toSource: Int32Array;
    /** Fraction of the rendered text that aligned, from 0 (nothing) to 1 (everything). */
    readonly matchedRatio: number;
}

/** Whether the two strings agree for {@link RESYNC_RUN} characters from these offsets. */
function runAgrees(rendered: string, renderedFrom: number, source: string, sourceFrom: number): boolean {
    for (let k = 1; k < RESYNC_RUN; k++) {
        if (renderedFrom + k >= rendered.length) {
            // Nothing left to place, so nothing left to disagree.
            return true;
        }
        // Source exhausted while rendered text remains is a disagreement, not a run. Reading it
        // as agreement would confirm a candidate at the very end of the source purely because
        // nothing follows it, and that beats the nearer candidate that actually continues.
        if (sourceFrom + k >= source.length || rendered[renderedFrom + k] !== source[sourceFrom + k]) {
            return false;
        }
    }

    return true;
}

/**
 * Source index anchoring `rendered[renderedFrom]`, searching forward from `sourceFrom`.
 *
 * A candidate that starts an agreeing run wins outright. Otherwise the nearest bare character
 * match stands in, which is what keeps the character on either side of a substitution anchored:
 * neither can agree for a full run, because the substitution itself is in the way.
 */
function findAnchor(rendered: string, renderedFrom: number, source: string, sourceFrom: number): number {
    const limit = Math.min(sourceFrom + RESYNC_WINDOW, source.length);
    let nearest = -1;

    for (let j = sourceFrom; j < limit; j++) {
        if (source[j] !== rendered[renderedFrom]) {
            continue;
        }
        if (runAgrees(rendered, renderedFrom, source, j)) {
            return j;
        }
        if (nearest < 0) {
            nearest = j;
        }
    }

    return nearest;
}

/**
 * Aligns rendered text back onto the source it came from.
 *
 * Returns null only when either side is longer than {@link MAX_ALIGNMENT_LENGTH}, which callers
 * treat as "no better placement is available" rather than as an error. Empty rendered text is
 * fully matched: the only caret it has is at offset 0.
 */
export function alignRenderedToSource(rendered: string, source: string): TextAlignment | null {
    if (rendered.length > MAX_ALIGNMENT_LENGTH || source.length > MAX_ALIGNMENT_LENGTH) {
        return null;
    }

    const toSource = new Int32Array(rendered.length).fill(-1);
    let sourceIndex = 0;
    let matched = 0;

    for (let i = 0; i < rendered.length; i++) {
        const anchor = findAnchor(rendered, i, source, sourceIndex);
        if (anchor < 0) {
            continue;
        }

        toSource[i] = anchor;
        sourceIndex = anchor + 1;
        matched++;
    }

    return { toSource, matchedRatio: rendered.length === 0 ? 1 : matched / rendered.length };
}

/**
 * Maps a caret offset in the rendered text to a caret offset in the source.
 *
 * A caret sits between characters, so it is resolved from the aligned character on either
 * side of it, whichever is nearer; a tie prefers the character after the caret, which keeps
 * a caret inside a matched run exactly where it was. Landing in a gap therefore yields the
 * closest anchor rather than nothing, which is still far more useful than the start of
 * the cell.
 *
 * Both ends are pinned: clicking past the last rendered character means the end of the
 * source, including any trailing syntax, and the same in reverse at the start.
 */
export function mapCaretToSource(toSource: Int32Array, caret: number, sourceLength: number): number {
    if (caret <= 0) {
        return 0;
    }
    if (caret >= toSource.length) {
        return sourceLength;
    }

    let after = -1;
    for (let i = caret; i < toSource.length; i++) {
        if (toSource[i] >= 0) {
            after = i;
            break;
        }
    }

    let before = -1;
    for (let i = caret - 1; i >= 0; i--) {
        if (toSource[i] >= 0) {
            before = i;
            break;
        }
    }

    if (after < 0 && before < 0) {
        return 0;
    }
    if (after < 0) {
        return toSource[before] + 1;
    }
    if (before < 0) {
        return toSource[after];
    }

    return after - caret <= caret - 1 - before ? toSource[after] : toSource[before] + 1;
}

/** A source range, as the offsets the nested editor should select between. */
export interface SourceSpan {
    from: number;
    to: number;
}

/**
 * Maps a selected range of rendered text to the source span covering it.
 *
 * A range is mapped from the characters it holds rather than by mapping each end as a caret.
 * A caret at the seam between a matched run and hidden syntax takes the offset after it, which
 * is right for a caret but pulls a range's end across the syntax that follows: selecting
 * `bold text` out of `**bold text** aaa` would select `bold text**`. Reading the span off the
 * covered characters instead includes syntax only where the selection actually spans it.
 *
 * A range covering every rendered character takes the whole source, keeping both pins of
 * {@link mapCaretToSource}, so select-all inside a cell still selects its Markdown entire.
 *
 * A range holding no aligned character at all - a run of emoji or a formula - falls back to
 * mapping each end as a caret.
 */
export function mapSelectionToSource(toSource: Int32Array, from: number, to: number, sourceLength: number): SourceSpan {
    if (from <= 0 && to >= toSource.length) {
        return { from: 0, to: sourceLength };
    }

    let first = -1;
    let last = -1;
    for (let i = Math.max(from, 0); i < Math.min(to, toSource.length); i++) {
        if (toSource[i] < 0) {
            continue;
        }
        if (first < 0) {
            first = toSource[i];
        }
        last = toSource[i];
    }

    return first < 0
        ? { from: mapCaretToSource(toSource, from, sourceLength), to: mapCaretToSource(toSource, to, sourceLength) }
        : { from: first, to: last + 1 };
}
