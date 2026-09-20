import { Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { hasRequiredBlankLinesAfter, hasRequiredBlankLinesBefore } from '../tableRuntime/tableBoundarySpacing';

const TABLE_LINES = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'];

describe('hasRequiredBlankLinesBefore', () => {
    it('treats the document start as unseparated', () => {
        const doc = Text.of(TABLE_LINES);
        expect(hasRequiredBlankLinesBefore(doc, 0)).toBe(false);
    });

    it('is true when the previous line is blank', () => {
        const doc = Text.of(['', ...TABLE_LINES]);
        expect(hasRequiredBlankLinesBefore(doc, doc.line(2).from)).toBe(true);
    });

    it('is false when the previous line has text', () => {
        const doc = Text.of(['intro', ...TABLE_LINES]);
        expect(hasRequiredBlankLinesBefore(doc, doc.line(2).from)).toBe(false);
    });
});

describe('hasRequiredBlankLinesAfter', () => {
    it('treats the document end as unseparated', () => {
        const doc = Text.of(TABLE_LINES);
        expect(hasRequiredBlankLinesAfter(doc, doc.length)).toBe(false);
    });

    it('is true when the next line is blank', () => {
        const doc = Text.of([...TABLE_LINES, '']);
        expect(hasRequiredBlankLinesAfter(doc, doc.line(TABLE_LINES.length).to)).toBe(true);
    });

    it('is false when the next line has text', () => {
        const doc = Text.of([...TABLE_LINES, 'after']);
        expect(hasRequiredBlankLinesAfter(doc, doc.line(TABLE_LINES.length).to)).toBe(false);
    });
});
