import { describe, expect, it } from '@jest/globals';
import { escapeUnescapedPipes } from '../nestedEditor/transactionPolicy';

describe('escapeUnescapedPipes', () => {
    it('escapes unescaped pipes', () => {
        expect(escapeUnescapedPipes('a|b')).toBe('a\\|b');
        expect(escapeUnescapedPipes('|')).toBe('\\|');
        expect(escapeUnescapedPipes('a|b|c')).toBe('a\\|b\\|c');
    });

    it('keeps already-escaped pipes intact', () => {
        expect(escapeUnescapedPipes('a\\|b')).toBe('a\\|b');
    });
});
