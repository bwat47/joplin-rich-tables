import { describe, expect, it } from 'vitest';
import { countBlankLinesInRun, type NewlineScan } from '../tableRuntime/tableBoundaryResolution';

function scan(count: number, reachesDocumentEdge: boolean): NewlineScan {
    return { count, edge: 0, reachesDocumentEdge };
}

describe('countBlankLinesInRun', () => {
    it('treats N interior newlines as N-1 blank lines', () => {
        expect(countBlankLinesInRun(scan(1, false), scan(1, false))).toBe(1);
        expect(countBlankLinesInRun(scan(2, false), scan(1, false))).toBe(2);
    });

    it('treats N newlines at a document edge as N blank lines', () => {
        expect(countBlankLinesInRun(scan(1, true), scan(0, false))).toBe(1);
        expect(countBlankLinesInRun(scan(0, false), scan(2, true))).toBe(2);
    });

    it('counts an empty run as no blank lines', () => {
        expect(countBlankLinesInRun(scan(0, false), scan(0, false))).toBe(0);
        expect(countBlankLinesInRun(scan(0, true), scan(0, true))).toBe(0);
    });
});
