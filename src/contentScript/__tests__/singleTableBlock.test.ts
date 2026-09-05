import { describe, expect, it } from 'vitest';
import { parseSingleTableBlock } from '../tableModel/singleTableBlock';

const NON_CANONICAL_TABLE = ['|H1|H2|', '|---|---|', '|a|b|'].join('\n');
const CANONICAL_TABLE = ['| H1 | H2 |', '| --- | --- |', '| a | b |'].join('\n');

describe('parseSingleTableBlock', () => {
    it('accepts a valid table', () => {
        expect(parseSingleTableBlock(CANONICAL_TABLE)?.serialize()).toBe(CANONICAL_TABLE);
    });

    it('accepts a valid table with outer blank lines', () => {
        expect(parseSingleTableBlock(`\n\n${NON_CANONICAL_TABLE}\n\n`)?.serialize()).toBe(CANONICAL_TABLE);
    });

    it('accepts a table with CRLF line endings', () => {
        expect(parseSingleTableBlock(NON_CANONICAL_TABLE.split('\n').join('\r\n'))?.serialize()).toBe(CANONICAL_TABLE);
    });

    it('accepts a table whose delimiter row carries trailing padding', () => {
        const padded = ['| H1 | H2 |', '| --- | --- | ', '| a | b |\t'].join('\n');

        expect(parseSingleTableBlock(padded)?.serialize()).toBe(CANONICAL_TABLE);
    });

    it.each([
        ['space', String.raw`\ `],
        ['tab', '\\' + '\t'],
    ])('drops the trailing %s Lezer pulls past a backslash in clipboard cells', (_label, suffix) => {
        const text = [`a | value${suffix}`, '--- | ---  ', `b | value${suffix}`].join('\n');
        const table = parseSingleTableBlock(text);

        expect(table?.headerCells).toEqual(['a', 'value\\']);
        expect(table?.bodyRows).toEqual([['b', 'value\\']]);
    });

    it('rejects multiple tables separated by blank lines', () => {
        const secondTable = ['| H2 |', '| --- |', '| b |'].join('\n');

        expect(parseSingleTableBlock(`${CANONICAL_TABLE}\n\n${secondTable}`)).toBeNull();
    });

    it('rejects multiple tables separated by a CRLF blank line', () => {
        const secondTable = ['| H2 |', '| --- |', '| b |'].join('\n');

        expect(parseSingleTableBlock(`${CANONICAL_TABLE}\r\n\r\n${secondTable}`)).toBeNull();
    });

    it('rejects a table containing an internal whitespace-only line', () => {
        const splitTable = ['| H1 | H2 |', '| --- | --- |', '| a | b |', '   ', '| c | d |'].join('\n');

        expect(parseSingleTableBlock(splitTable)).toBeNull();
    });

    it('accepts a pipe-free trailing row recognized by Lezer', () => {
        expect(parseSingleTableBlock(`${CANONICAL_TABLE}\ntrailing text`)?.serialize()).toBe(
            `${CANONICAL_TABLE}\n| trailing text |  |`
        );
    });

    it('rejects leading text plus table', () => {
        expect(parseSingleTableBlock(`leading text\n${CANONICAL_TABLE}`)).toBeNull();
    });

    it('rejects non-table text', () => {
        expect(parseSingleTableBlock('plain text')).toBeNull();
    });

    it('rejects empty text', () => {
        expect(parseSingleTableBlock('\n \n')).toBeNull();
    });
});
