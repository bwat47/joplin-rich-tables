/**
 * Character-level alignment between a rendered string and the source it was rendered from.
 *
 * Markdown rendering is lossy in one direction only: syntax characters disappear, but the
 * text that survives normally appears in the source in the same order. That makes the
 * rendered text a subsequence of its source for the inline constructs cells actually
 * contain (`**bold**`, `[text](url)`, `` `code` ``, `~~strike~~`, raw HTML), so a diff
 * recovers where each rendered character came from without the renderer emitting a source
 * map.
 *
 * The algorithm is the recursive longest-matching-block scheme used by Python's `difflib`,
 * not a plain LCS. Both maximise the number of matched characters, but LCS is free to
 * scatter its matches: aligning `link` against `[link](http://link.com)` may legally pick
 * characters out of the URL. Anchoring on the longest common block first and recursing into
 * the gaps prefers long contiguous runs and, on ties, the earliest source position - which
 * is what a caret placement needs.
 *
 * Substitutions that are not subsequences (`&amp;` to `&`, `:smile:` to an emoji, KaTeX to
 * MathML) simply leave a gap. Because each gap is bounded by the blocks around it, the
 * damage stays local instead of desynchronising everything that follows, and
 * `matchedRatio` reports how much of the rendered text failed to find a home.
 */

/**
 * Longest length either side may have before alignment is refused.
 *
 * Block matching is O(n*m) in the worst case (a cell of one repeated character), so the cap
 * bounds the cost of a hit test that runs on a click. Cells this long are far past the point
 * where a caret lands somewhere the reader was looking anyway.
 */
const MAX_ALIGNMENT_LENGTH = 1000;

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
function indexCharacterPositions(source: string, excluded?: Uint8Array): Map<string, number[]> {
    const positions = new Map<string, number[]>();
    for (let i = 0; i < source.length; i++) {
        if (excluded?.[i]) {
            continue;
        }

        const existing = positions.get(source[i]);
        if (existing) {
            existing.push(i);
        } else {
            positions.set(source[i], [i]);
        }
    }
    return positions;
}

/** Whether `character` can start an HTML tag name, e.g. the `s` in `<span>`. */
function isAsciiLetter(character: string | undefined): boolean {
    if (!character) {
        return false;
    }
    const code = character.charCodeAt(0);
    return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/** Whether `character` can continue an HTML tag name, including custom elements such as `x-note`. */
function isHtmlTagNameCharacter(character: string | undefined): boolean {
    if (!character) {
        return false;
    }
    const code = character.charCodeAt(0);
    return isAsciiLetter(character) || (code >= 48 && code <= 57) || character === '-';
}

/** A tag name must be followed by whitespace, `/>`, or `>`; this excludes autolinks such as `<https://x>`. */
function isHtmlTagNameBoundary(character: string | undefined): boolean {
    return character !== undefined && (/\s/.test(character) || character === '/' || character === '>');
}

/** Finds a closing `>` without mistaking one inside a quoted attribute value for the end of the tag. */
function findTagEnd(source: string, from: number): number {
    let quote: '"' | "'" | null = null;
    for (let i = from; i < source.length; i++) {
        const character = source[i];
        if (quote) {
            if (character === quote) {
                quote = null;
            }
        } else if (character === '"' || character === "'") {
            quote = character;
        } else if (character === '>') {
            return i + 1;
        }
    }
    return -1;
}

/** Returns the exclusive end of an HTML token at `from`, or -1 when `<` starts ordinary text such as an autolink. */
function rawHtmlTokenEnd(source: string, from: number): number {
    if (source.startsWith('<!--', from)) {
        const close = source.indexOf('-->', from + 4);
        return close < 0 ? -1 : close + 3;
    }
    if (source.startsWith('<![CDATA[', from)) {
        const close = source.indexOf(']]>', from + 9);
        return close < 0 ? -1 : close + 3;
    }
    if (source.startsWith('<?', from)) {
        const close = source.indexOf('?>', from + 2);
        return close < 0 ? -1 : close + 2;
    }
    if (source.startsWith('<!', from)) {
        return findTagEnd(source, from + 2);
    }

    let cursor = from + 1;
    if (source[cursor] === '/') {
        cursor++;
    }
    if (!isAsciiLetter(source[cursor])) {
        return -1;
    }
    cursor++;
    while (isHtmlTagNameCharacter(source[cursor])) {
        cursor++;
    }
    if (!isHtmlTagNameBoundary(source[cursor])) {
        return -1;
    }

    return findTagEnd(source, cursor);
}

/**
 * Marks probable raw-HTML syntax so visible text prefers the occurrence between tags over an
 * identical tag name, attribute value, or comment that appears earlier in the source.
 *
 * The caller compares this preferred alignment with an unrestricted one. That preserves
 * literal tags rendered by code spans, where excluding the tag-shaped source would lose
 * matches, while fixing raw HTML such as `<code>code</code>`.
 */
function rawHtmlSyntaxMask(source: string): Uint8Array | null {
    let mask: Uint8Array | null = null;
    let i = 0;
    while (i < source.length) {
        if (source[i] !== '<') {
            i++;
            continue;
        }

        const to = rawHtmlTokenEnd(source, i);
        if (to < 0) {
            i++;
            continue;
        }

        mask ??= new Uint8Array(source.length);
        mask.fill(1, i, to);
        i = to;
    }
    return mask;
}

/**
 * Longest run common to `rendered[renderedFrom, renderedTo)` and `source[sourceFrom, sourceTo)`.
 *
 * `runLengths` holds, per source index, the length of the common run ending at the previous
 * rendered character, so extending a run is a single lookup. Ties keep the first run found,
 * which is the earliest position in both strings because the position lists ascend.
 *
 * Returns a zero-length block when the ranges share no characters.
 */
function findLongestMatch(
    rendered: string,
    sourcePositions: Map<string, number[]>,
    renderedFrom: number,
    renderedTo: number,
    sourceFrom: number,
    sourceTo: number
): MatchingBlock {
    let best: MatchingBlock = { renderedFrom, sourceFrom, length: 0 };
    let runLengths = new Map<number, number>();

    for (let i = renderedFrom; i < renderedTo; i++) {
        const nextRunLengths = new Map<number, number>();
        for (const j of sourcePositions.get(rendered[i]) ?? []) {
            if (j < sourceFrom) {
                continue;
            }
            if (j >= sourceTo) {
                break;
            }

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
 */
function collectMatchingBlocks(
    rendered: string,
    sourcePositions: Map<string, number[]>,
    sourceLength: number
): MatchingBlock[] {
    const blocks: MatchingBlock[] = [];
    const pending: Array<[number, number, number, number]> = [[0, rendered.length, 0, sourceLength]];

    while (pending.length > 0) {
        const [renderedFrom, renderedTo, sourceFrom, sourceTo] = pending.pop() as [number, number, number, number];
        if (renderedFrom >= renderedTo || sourceFrom >= sourceTo) {
            continue;
        }

        const match = findLongestMatch(rendered, sourcePositions, renderedFrom, renderedTo, sourceFrom, sourceTo);
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
 * Returns null when either side is longer than {@link MAX_ALIGNMENT_LENGTH}; callers treat
 * that as "no better placement is available" rather than as an error.
 */
export function alignRenderedToSource(rendered: string, source: string): TextAlignment | null {
    if (rendered.length > MAX_ALIGNMENT_LENGTH || source.length > MAX_ALIGNMENT_LENGTH) {
        return null;
    }

    if (rendered.length === 0) {
        // Nothing to place is vacuously well aligned: the only caret is at offset 0.
        return { toSource: new Int32Array(), matchedRatio: 1 };
    }

    const align = (excluded?: Uint8Array): TextAlignment => {
        const toSource = new Int32Array(rendered.length).fill(-1);
        let matched = 0;
        for (const block of collectMatchingBlocks(rendered, indexCharacterPositions(source, excluded), source.length)) {
            for (let k = 0; k < block.length; k++) {
                toSource[block.renderedFrom + k] = block.sourceFrom + k;
            }
            matched += block.length;
        }

        return { toSource, matchedRatio: matched / rendered.length };
    };

    const syntaxMask = rawHtmlSyntaxMask(source);
    if (!syntaxMask) {
        return align();
    }

    // Prefer matches outside raw-HTML syntax when that does not sacrifice any rendered text.
    // If the source contains tag-shaped literal code, the unrestricted alignment wins instead.
    const preferred = align(syntaxMask);
    if (preferred.matchedRatio === 1) {
        return preferred;
    }

    const unrestricted = align();
    return preferred.matchedRatio >= unrestricted.matchedRatio ? preferred : unrestricted;
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
export function mapCaretToSource(alignment: TextAlignment, caret: number, sourceLength: number): number {
    const { toSource } = alignment;
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
