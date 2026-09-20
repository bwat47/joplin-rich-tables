import { Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
    hasRequiredBlankLinesAfter,
    hasRequiredBlankLinesBefore,
    needsLeadingSeparator,
    needsTrailingSeparator,
} from '../tableRuntime/tableBoundarySpacing';

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

describe('needsLeadingSeparator', () => {
    it('treats the document start as unseparated', () => {
        expect(needsLeadingSeparator(Text.of(TABLE_LINES), 0)).toBe(true);
    });

    it('treats a caret on a leading blank line as unseparated', () => {
        expect(needsLeadingSeparator(Text.of(['', ...TABLE_LINES]), 0)).toBe(true);
    });

    it('is false when the previous line is already the required blank line', () => {
        const doc = Text.of(['', ...TABLE_LINES]);
        expect(needsLeadingSeparator(doc, doc.line(2).from)).toBe(false);
    });

    it('treats a mid-line position as unseparated from the text on that line', () => {
        expect(needsLeadingSeparator(Text.of(['hello']), 2)).toBe(true);
    });
});

describe('needsTrailingSeparator', () => {
    it('treats the document end as unseparated', () => {
        const flush = Text.of(TABLE_LINES);
        expect(needsTrailingSeparator(flush, flush.length)).toBe(true);
    });

    it('treats a caret on the final empty line as unseparated', () => {
        const blankLastLine = Text.of([...TABLE_LINES, '']);
        expect(needsTrailingSeparator(blankLastLine, blankLastLine.length)).toBe(true);
    });

    it('is false when the next line is already the required blank line', () => {
        const doc = Text.of([...TABLE_LINES, '']);
        expect(needsTrailingSeparator(doc, doc.line(TABLE_LINES.length).to)).toBe(false);
    });

    it('treats a mid-line position as unseparated even when the next line is blank', () => {
        const doc = Text.of(['hello', '']);
        expect(needsTrailingSeparator(doc, 2)).toBe(true);
    });
});
