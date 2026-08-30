import { describe, expect, it } from 'vitest';
import { calculateEdgeScrollIntensity } from '../tableRuntime/interaction/mouseCellDragAutoScroll';

describe('calculateEdgeScrollIntensity', () => {
    it('returns zero outside the edge zones', () => {
        expect(calculateEdgeScrollIntensity(50, 0, 100, 20)).toBe(0);
    });

    it('increases toward each edge and clamps outside the range', () => {
        expect(calculateEdgeScrollIntensity(10, 0, 100, 20)).toBe(-0.5);
        expect(calculateEdgeScrollIntensity(-10, 0, 100, 20)).toBe(-1);
        expect(calculateEdgeScrollIntensity(90, 0, 100, 20)).toBe(0.5);
        expect(calculateEdgeScrollIntensity(110, 0, 100, 20)).toBe(1);
    });

    it('keeps edge zones from overlapping in a small range', () => {
        expect(calculateEdgeScrollIntensity(4, 0, 10, 20)).toBeLessThan(0);
        expect(calculateEdgeScrollIntensity(5, 0, 10, 20)).toBe(0);
        expect(calculateEdgeScrollIntensity(6, 0, 10, 20)).toBeGreaterThan(0);
    });

    it('rejects empty ranges and non-positive edge sizes', () => {
        expect(calculateEdgeScrollIntensity(0, 10, 10, 20)).toBe(0);
        expect(calculateEdgeScrollIntensity(0, 0, 100, 0)).toBe(0);
    });
});
