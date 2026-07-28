import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_ENTRIES, tableHeightCache } from '../tableWidget/tableHeightCache';

const HEIGHT = 120;

/** Distinct table text and a distinct document position for table number `n`. */
function tableAt(n: number): { tableFrom: number; tableText: string } {
    return { tableFrom: n * 1000, tableText: `| h${n} |\n| --- |\n| c${n} |` };
}

describe('tableHeightCache', () => {
    beforeEach(() => {
        tableHeightCache.clear();
    });

    it('returns a measured height for the same table', () => {
        const table = tableAt(1);
        tableHeightCache.set({ ...table, heightPx: HEIGHT });

        expect(tableHeightCache.get(table)).toBe(HEIGHT);
    });

    it('returns the height after the table moves, matching on text', () => {
        const table = tableAt(1);
        tableHeightCache.set({ ...table, heightPx: HEIGHT });

        expect(tableHeightCache.get({ tableFrom: table.tableFrom + 500, tableText: table.tableText })).toBe(HEIGHT);
    });

    it('returns the height after the table text changes, matching on position', () => {
        const table = tableAt(1);
        tableHeightCache.set({ ...table, heightPx: HEIGHT });

        expect(tableHeightCache.get({ tableFrom: table.tableFrom, tableText: '| edited |\n| --- |' })).toBe(HEIGHT);
    });

    it('prefers its own measurement over whatever was last measured at its position', () => {
        const evicted = tableAt(1);
        const shiftedUp = { tableFrom: evicted.tableFrom, tableText: tableAt(2).tableText };
        const OWN_HEIGHT = 300;

        // Both tables have been measured; then the one above is deleted and the second
        // table slides into the first one's offset.
        tableHeightCache.set({ ...evicted, heightPx: HEIGHT });
        tableHeightCache.set({ ...tableAt(2), heightPx: OWN_HEIGHT });

        expect(tableHeightCache.get(shiftedUp)).toBe(OWN_HEIGHT);
    });

    it('ignores non-positive and non-finite measurements', () => {
        const table = tableAt(1);

        tableHeightCache.set({ ...table, heightPx: 0 });
        tableHeightCache.set({ ...table, heightPx: Number.NaN });

        expect(tableHeightCache.get(table)).toBeUndefined();
    });

    it('retains MAX_ENTRIES tables, not half that', () => {
        // Every measurement writes both a text and a position entry. Under a single
        // shared budget that made the real capacity MAX_ENTRIES / 2 tables.
        for (let n = 0; n < MAX_ENTRIES; n++) {
            tableHeightCache.set({ ...tableAt(n), heightPx: HEIGHT });
        }

        expect(tableHeightCache.get(tableAt(0))).toBe(HEIGHT);
        expect(tableHeightCache.get(tableAt(MAX_ENTRIES - 1))).toBe(HEIGHT);
    });

    it('evicts the least recently used table once full', () => {
        for (let n = 0; n < MAX_ENTRIES; n++) {
            tableHeightCache.set({ ...tableAt(n), heightPx: HEIGHT });
        }

        tableHeightCache.set({ ...tableAt(MAX_ENTRIES), heightPx: HEIGHT });

        expect(tableHeightCache.get(tableAt(0))).toBeUndefined();
        expect(tableHeightCache.get(tableAt(MAX_ENTRIES))).toBe(HEIGHT);
    });

    it('spares a table that was read recently', () => {
        for (let n = 0; n < MAX_ENTRIES; n++) {
            tableHeightCache.set({ ...tableAt(n), heightPx: HEIGHT });
        }

        // Reading table 0 refreshes its recency, so the next insert evicts a table
        // that has not been touched since it was measured.
        expect(tableHeightCache.get(tableAt(0))).toBe(HEIGHT);
        tableHeightCache.set({ ...tableAt(MAX_ENTRIES), heightPx: HEIGHT });

        expect(tableHeightCache.get(tableAt(0))).toBe(HEIGHT);
    });
});
