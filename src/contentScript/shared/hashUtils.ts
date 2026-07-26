/**
 * FNV-1a 32-bit hash function.
 * Fast, simple, and provides reasonable distribution for short strings.
 */
function fnv1aHash(text: string): number {
    let hash = 2_166_136_261;
    for (let i = 0; i < text.length; i++) {
        // FNV-1a is defined over code units, and this runs once per table on
        // every decoration rebuild. Iterating code points instead would mean
        // allocating a string per character in a hot path.
        // eslint-disable-next-line unicorn/prefer-code-point
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16_777_619);
    }
    return hash >>> 0; // Convert to unsigned 32-bit
}

/**
 * Hash a table's text content for quick equality comparison.
 * Includes length in the output to reduce collision risk.
 */
export function hashTableText(text: string): string {
    return `${fnv1aHash(text).toString(16)}:${text.length}`;
}
