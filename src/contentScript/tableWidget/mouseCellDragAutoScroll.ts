/**
 * Returns edge-scroll intensity from -1 (toward the start edge) to 1 (toward
 * the end edge). Positions outside the range stay at full intensity.
 */
export function calculateEdgeScrollIntensity(
    position: number,
    rangeStart: number,
    rangeEnd: number,
    edgeSize: number
): number {
    if (rangeEnd <= rangeStart || edgeSize <= 0) {
        return 0;
    }

    const effectiveEdgeSize = Math.min(edgeSize, (rangeEnd - rangeStart) / 2);
    const startEdgeEnd = rangeStart + effectiveEdgeSize;
    if (position < startEdgeEnd) {
        return -Math.min(1, (startEdgeEnd - position) / effectiveEdgeSize);
    }

    const endEdgeStart = rangeEnd - effectiveEdgeSize;
    if (position > endEdgeStart) {
        return Math.min(1, (position - endEdgeStart) / effectiveEdgeSize);
    }

    return 0;
}
