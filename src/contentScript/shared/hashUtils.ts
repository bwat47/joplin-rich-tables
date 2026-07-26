/**
 * FNV-1a 32-bit hash function.
 * Fast, simple, and provides reasonable distribution for short strings.
 */
function fnv1aHash(text: string): number {
    let hash = 2_166_136_261;
    for (const character of text) {
        hash ^= character.codePointAt(0)!;
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
