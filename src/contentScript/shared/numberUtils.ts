/**
 * Clamps `value` to the inclusive range [min, max].
 * If `min > max`, returns `min` (the lower bound wins).
 */
export function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}
