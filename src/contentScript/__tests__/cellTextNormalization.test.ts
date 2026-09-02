import { describe, expect, it } from 'vitest';
import {
    convertNewlinesToBr,
    escapeUnescapedPipes,
    normalizeBrTags,
    sanitizeLocalText,
    unsanitizeRootText,
} from '../shared/cellTextNormalization';

describe('escapeUnescapedPipes', () => {
    it('escapes unescaped pipes', () => {
        expect(escapeUnescapedPipes('a|b')).toBe(String.raw`a\|b`);
        expect(escapeUnescapedPipes('|')).toBe(String.raw`\|`);
        expect(escapeUnescapedPipes('a|b|c')).toBe(String.raw`a\|b\|c`);
    });

    it('keeps already-escaped pipes intact', () => {
        expect(escapeUnescapedPipes(String.raw`a\|b`)).toBe(String.raw`a\|b`);
    });

    it('escapes pipes after even backslash runs and preserves them after odd runs', () => {
        expect(escapeUnescapedPipes(String.raw`a\\|b`)).toBe(String.raw`a\\\|b`);
        expect(escapeUnescapedPipes(String.raw`a\\\|b`)).toBe(String.raw`a\\\|b`);
    });
});

describe('convertNewlinesToBr', () => {
    it('converts LF, CRLF, and CR to <br>', () => {
        expect(convertNewlinesToBr('a\nb')).toBe('a<br>b');
        expect(convertNewlinesToBr('a\r\nb')).toBe('a<br>b');
        expect(convertNewlinesToBr('a\rb')).toBe('a<br>b');
    });
});

describe('normalizeBrTags', () => {
    it('canonicalizes self-closing br tags to <br>', () => {
        expect(normalizeBrTags('a<br/>b')).toBe('a<br>b');
        expect(normalizeBrTags('a<br />b')).toBe('a<br>b');
        expect(normalizeBrTags('a<BR/>b')).toBe('a<br>b');
    });
});

describe('sanitizeLocalText / unsanitizeRootText', () => {
    it('converts local newlines and pipes to markdown-safe cell text', () => {
        expect(sanitizeLocalText('a\nb|c')).toBe(String.raw`a<br>b\|c`);
    });

    it('normalizes self-closing br tags before syncing to root text', () => {
        expect(sanitizeLocalText('a<br/>b|c')).toBe(String.raw`a<br>b\|c`);
        expect(sanitizeLocalText('a<br />b|c')).toBe(String.raw`a<br>b\|c`);
    });

    it('preserves trailing spaces during live editing sync', () => {
        expect(sanitizeLocalText('sometext ')).toBe('sometext ');
    });

    it('converts root markdown-safe cell text back to local display text', () => {
        expect(unsanitizeRootText(String.raw`a<br>b\|c`)).toBe('a\nb|c');
    });
});
