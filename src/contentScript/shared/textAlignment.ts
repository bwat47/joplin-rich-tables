/**
 * Bounded character alignment for rendered text that differs from its visible-source
 * projection. The caller removes hidden Markdown before alignment; matching raw source
 * alone cannot distinguish visible text from identical link titles or image descriptions.
 *
 * Longest contiguous blocks anchor the mapping, with a complete-subsequence fallback for
 * repeated text. Renderer substitutions may leave unmatched characters, resolved by nearby
 * anchors. The matched ratio measures coverage, not semantic certainty.
 */

/** Maximum input length for fallback alignment; direct mappings bypass this limit. */
const MAX_ALIGNMENT_LENGTH = 1000;

/**
 * Comparison budget shared by all longest-block scans in one fallback alignment.
 * Repeated characters and fragmented matches can cause expensive rescans even within the
 * length limit. Exhausting this budget declines placement; it does not bound elapsed time.
 */
const MAX_ALIGNMENT_CANDIDATES = 2_000_000;

/** Remaining comparison budget, shared by every scan in one alignment. */
interface AlignmentBudget {
    remaining: number;
}

/** A run of characters that is identical in both strings. */
interface MatchingBlock {
    renderedFrom: number;
    sourceFrom: number;
    length: number;
}

export interface TextAlignment {
    /** Source index each rendered index maps to, or -1 where the character did not align. */
    readonly toSource: Int32Array;
    /** Fraction of the rendered text that aligned, from 0 (nothing) to 1 (everything). */
    readonly matchedRatio: number;
}

/** Character to ascending list of positions, so block matching can skip non-candidates. */
function indexCharacterPositions(source: string): Map<string, number[]> {
    const positions = new Map<string, number[]>();
    for (let i = 0; i < source.length; i++) {
        const existing = positions.get(source[i]);
        if (existing) {
            existing.push(i);
        } else {
            positions.set(source[i], [i]);
        }
    }
    return positions;
}

/**
 * Maps every rendered character to its earliest available source occurrence in order.
 *
 * Choosing the earliest match cannot prevent a later match that another subsequence could
 * make, so a single forward scan is enough to prove whether the rendered text is a complete
 * subsequence. This repairs repeated-text cases where longest-block alignment commits to a
 * later run and strands otherwise matchable characters on one side of it.
 */
function alignCompleteSubsequence(rendered: string, source: string): TextAlignment | null {
    const toSource = new Int32Array(rendered.length);
    let sourceIndex = 0;

    for (let renderedIndex = 0; renderedIndex < rendered.length; renderedIndex++) {
        while (sourceIndex < source.length && source[sourceIndex] !== rendered[renderedIndex]) {
            sourceIndex++;
        }

        if (sourceIndex >= source.length) {
            return null;
        }

        toSource[renderedIndex] = sourceIndex;
        sourceIndex++;
    }

    return { toSource, matchedRatio: 1 };
}

/**
 * Longest run common to `rendered[renderedFrom, renderedTo)` and `source[sourceFrom, sourceTo)`.
 *
 * `runLengths` holds, per source index, the length of the common run ending at the previous
 * rendered character, so extending a run is a single lookup. Ties keep the first run found,
 * which is the earliest position in both strings because the position lists ascend.
 *
 * Returns a zero-length block when the ranges share no characters, and null when `budget`
 * ran out before the scan finished, which makes a truncated scan impossible to mistake for
 * a completed one.
 */
function findLongestMatch(
    rendered: string,
    sourcePositions: Map<string, number[]>,
    renderedFrom: number,
    renderedTo: number,
    sourceFrom: number,
    sourceTo: number,
    budget: AlignmentBudget
): MatchingBlock | null {
    let best: MatchingBlock = { renderedFrom, sourceFrom, length: 0 };
    let runLengths = new Map<number, number>();

    for (let i = renderedFrom; i < renderedTo; i++) {
        if (budget.remaining <= 0) {
            return null;
        }

        const nextRunLengths = new Map<number, number>();
        for (const j of sourcePositions.get(rendered[i]) ?? []) {
            if (j < sourceFrom) {
                continue;
            }
            if (j >= sourceTo) {
                break;
            }

            budget.remaining--;
            const length = (runLengths.get(j - 1) ?? 0) + 1;
            nextRunLengths.set(j, length);
            if (length > best.length) {
                best = { renderedFrom: i - length + 1, sourceFrom: j - length + 1, length };
            }
        }
        runLengths = nextRunLengths;
    }

    return best;
}

/**
 * Every matching block, found by anchoring on the longest one and recursing into the
 * unmatched region on each side of it.
 *
 * The recursion is an explicit stack: a pathological input can nest as deeply as the strings
 * are long, and the cap alone is not a reason to spend that on the call stack. Blocks come
 * back unordered, which is all the caller needs to fill a lookup table.
 *
 * Returns null once the shared budget runs out. Partial blocks are discarded rather than
 * returned, because the stack descends into one gap at a time: whatever it had found would
 * cover one end of the cell and leave the other unanchored, which places a caret confidently
 * in the wrong place. Declining hands the caller the fallback it already has.
 */
function collectMatchingBlocks(
    rendered: string,
    sourcePositions: Map<string, number[]>,
    sourceLength: number
): MatchingBlock[] | null {
    const blocks: MatchingBlock[] = [];
    const budget: AlignmentBudget = { remaining: MAX_ALIGNMENT_CANDIDATES };
    const pending: Array<[number, number, number, number]> = [[0, rendered.length, 0, sourceLength]];

    while (pending.length > 0) {
        const [renderedFrom, renderedTo, sourceFrom, sourceTo] = pending.pop() as [number, number, number, number];
        if (renderedFrom >= renderedTo || sourceFrom >= sourceTo) {
            continue;
        }

        const match = findLongestMatch(
            rendered,
            sourcePositions,
            renderedFrom,
            renderedTo,
            sourceFrom,
            sourceTo,
            budget
        );
        if (!match) {
            return null;
        }
        if (match.length === 0) {
            continue;
        }

        blocks.push(match);
        pending.push([renderedFrom, match.renderedFrom, sourceFrom, match.sourceFrom]);
        pending.push([match.renderedFrom + match.length, renderedTo, match.sourceFrom + match.length, sourceTo]);
    }

    return blocks;
}

/**
 * Aligns rendered text back onto the source it came from.
 *
 * Returns null when either side is longer than {@link MAX_ALIGNMENT_LENGTH}, or when the
 * text is shaped such that aligning it would cost more than {@link MAX_ALIGNMENT_CANDIDATES}
 * comparisons; callers treat that as "no better placement is available" rather than as an
 * error.
 */
export function alignRenderedToSource(rendered: string, source: string): TextAlignment | null {
    if (rendered.length > MAX_ALIGNMENT_LENGTH || source.length > MAX_ALIGNMENT_LENGTH) {
        return null;
    }

    if (rendered.length === 0) {
        // Nothing to place is vacuously well aligned: the only caret is at offset 0.
        return { toSource: new Int32Array(), matchedRatio: 1 };
    }

    const blocks = collectMatchingBlocks(rendered, indexCharacterPositions(source), source.length);
    if (!blocks) {
        return null;
    }

    const toSource = new Int32Array(rendered.length).fill(-1);
    let matched = 0;
    for (const block of blocks) {
        for (let k = 0; k < block.length; k++) {
            toSource[block.renderedFrom + k] = block.sourceFrom + k;
        }
        matched += block.length;
    }

    const blockAlignment = { toSource, matchedRatio: matched / rendered.length };
    if (matched === rendered.length) {
        return blockAlignment;
    }

    return alignCompleteSubsequence(rendered, source) ?? blockAlignment;
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
