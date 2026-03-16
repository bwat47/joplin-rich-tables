/**
 * FNV-1a 32-bit hash function.
 * Fast, simple, and provides reasonable distribution for short strings.
 */
export function fnv1aHash(text: string): number {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
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
