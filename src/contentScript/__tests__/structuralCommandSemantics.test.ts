import { MarkdownTable, type TableAlignment } from '../tableModel/MarkdownTable';
import {
    applyStructuralTableCommand,
    type StructuralTableCommandResult,
    type StructuralTableCommand,
    type StructuralTableCommandId,
} from '../tableModel/structuralCommandSemantics';
import type { CellCoords } from '../tableModel/types';

function parseTable(markdown: string): MarkdownTable {
    const table = MarkdownTable.parse(markdown);
    if (!table) {
        throw new Error('Expected valid markdown table fixture');
    }
    return table;
}

function apply(markdown: string, activeCell: CellCoords, command: StructuralTableCommand) {
    return applyStructuralTableCommand(parseTable(markdown), activeCell, command);
}

function expectTableResult(result: StructuralTableCommandResult) {
    expect(result.kind).toBe('table');
    if (result.kind !== 'table') {
        throw new Error('Expected table result');
    }

    return result;
}

describe('structuralCommandSemantics', () => {
    const tableMarkdown = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |', '| b1 | b2 |'].join('\n');

    it.each([
        [
            { section: 'header', row: 0, col: 1 },
            { section: 'header', row: 0, col: 1 },
        ],
        [
            { section: 'body', row: 1, col: 1 },
            { section: 'body', row: 1, col: 1 },
        ],
    ] satisfies Array<[CellCoords, CellCoords]>)('targets inserted row before %#', (activeCell, targetCell) => {
        const result = apply(tableMarkdown, activeCell, { type: 'insertRowBefore' });
        const tableResult = expectTableResult(result);

        expect(tableResult.table.serialize()).toContain('|  |  |');
        expect(tableResult.targetCell).toEqual(targetCell);
    });

    it.each([
        [
            { section: 'header', row: 0, col: 1 },
            { section: 'body', row: 0, col: 1 },
        ],
        [
            { section: 'body', row: 1, col: 1 },
            { section: 'body', row: 2, col: 1 },
        ],
    ] satisfies Array<[CellCoords, CellCoords]>)('targets inserted row after %#', (activeCell, targetCell) => {
        const result = apply(tableMarkdown, activeCell, { type: 'insertRowAfter' });
        const tableResult = expectTableResult(result);

        expect(tableResult.table.serialize()).toContain('|  |  |');
        expect(tableResult.targetCell).toEqual(targetCell);
    });

    it('supports a caller-provided target column for inserted rows', () => {
        const result = apply(
            tableMarkdown,
            { section: 'body', row: 1, col: 1 },
            { type: 'insertRowAfter', targetCol: 0 }
        );
        const tableResult = expectTableResult(result);

        expect(tableResult.targetCell).toEqual({ section: 'body', row: 2, col: 0 });
    });

    it.each([
        [
            { section: 'header', row: 0, col: 1 },
            { section: 'header', row: 0, col: 1 },
        ],
        [
            { section: 'body', row: 0, col: 1 },
            { section: 'body', row: 0, col: 1 },
        ],
        [
            { section: 'body', row: 1, col: 1 },
            { section: 'body', row: 0, col: 1 },
        ],
    ] satisfies Array<[CellCoords, CellCoords]>)('targets deleted row %#', (activeCell, targetCell) => {
        const result = apply(tableMarkdown, activeCell, { type: 'deleteRow' });
        const tableResult = expectTableResult(result);

        expect(tableResult.targetCell).toEqual(targetCell);
    });

    it.each([
        ['insertColumnBefore', { section: 'body', row: 0, col: 1 }, { section: 'body', row: 0, col: 1 }],
        ['insertColumnAfter', { section: 'body', row: 0, col: 1 }, { section: 'body', row: 0, col: 2 }],
        ['deleteColumn', { section: 'body', row: 0, col: 0 }, { section: 'body', row: 0, col: 0 }],
        ['deleteColumn', { section: 'body', row: 0, col: 1 }, { section: 'body', row: 0, col: 0 }],
        ['moveColumnLeft', { section: 'body', row: 0, col: 1 }, { section: 'body', row: 0, col: 0 }],
        ['moveColumnRight', { section: 'body', row: 0, col: 0 }, { section: 'body', row: 0, col: 1 }],
    ] satisfies Array<[StructuralTableCommandId, CellCoords, CellCoords]>)(
        'targets column command %s',
        (type, activeCell, targetCell) => {
            const result = apply(tableMarkdown, activeCell, { type });
            const tableResult = expectTableResult(result);

            expect(tableResult.targetCell).toEqual(targetCell);
        }
    );

    it.each([
        ['moveColumnLeft', { section: 'body', row: 0, col: 0 }],
        ['moveColumnRight', { section: 'body', row: 0, col: 1 }],
    ] satisfies Array<[StructuralTableCommandId, CellCoords]>)(
        'preserves the active target for no-op column moves %s',
        (type, activeCell) => {
            const result = apply(tableMarkdown, activeCell, { type });
            const tableResult = expectTableResult(result);

            expect(tableResult.targetCell).toEqual(activeCell);
        }
    );

    it.each([
        ['moveRowUp', { section: 'header', row: 0, col: 1 }],
        ['moveRowDown', { section: 'body', row: 1, col: 1 }],
    ] satisfies Array<[StructuralTableCommandId, CellCoords]>)(
        'preserves target and table for no-op row boundaries %s',
        (type, activeCell) => {
            const result = apply(tableMarkdown, activeCell, { type });
            const tableResult = expectTableResult(result);

            expect(tableResult.targetCell).toEqual(activeCell);
            expect(tableResult.table.serialize()).toEqual(tableMarkdown);
        }
    );

    it.each([
        ['moveRowUp', { section: 'body', row: 0, col: 1 }, { section: 'header', row: 0, col: 1 }],
        ['moveRowUp', { section: 'body', row: 1, col: 1 }, { section: 'body', row: 0, col: 1 }],
        ['moveRowDown', { section: 'header', row: 0, col: 1 }, { section: 'body', row: 0, col: 1 }],
        ['moveRowDown', { section: 'body', row: 0, col: 1 }, { section: 'body', row: 1, col: 1 }],
    ] satisfies Array<[StructuralTableCommandId, CellCoords, CellCoords]>)(
        'targets row command %s',
        (type, activeCell, targetCell) => {
            const result = apply(tableMarkdown, activeCell, { type });
            const tableResult = expectTableResult(result);

            expect(tableResult.targetCell).toEqual(targetCell);
        }
    );

    it.each([
        ['clearTable', { section: 'header', row: 0, col: 0 }],
        ['clearRow', { section: 'body', row: 1, col: 1 }],
        ['clearColumn', { section: 'body', row: 0, col: 1 }],
    ] satisfies Array<[StructuralTableCommandId, CellCoords]>)('preserves target cell for %s', (type, activeCell) => {
        const result = apply(tableMarkdown, activeCell, { type });
        const tableResult = expectTableResult(result);

        expect(tableResult.targetCell).toEqual(activeCell);
    });

    it('deletes the table when deleting the only header row', () => {
        const headerOnlyTableMarkdown = ['| H1 | H2 |', '| --- | --- |'].join('\n');
        const activeCell = { section: 'header', row: 0, col: 1 } satisfies CellCoords;

        const result = apply(headerOnlyTableMarkdown, activeCell, { type: 'deleteRow' });

        expect(result).toEqual({ kind: 'deleteTable' });
    });

    it('preserves target and table when deleting an invalid body row in a header-only table', () => {
        const headerOnlyTableMarkdown = ['| H1 | H2 |', '| --- | --- |'].join('\n');
        const activeCell = { section: 'body', row: 0, col: 1 } satisfies CellCoords;

        const result = apply(headerOnlyTableMarkdown, activeCell, { type: 'deleteRow' });
        const tableResult = expectTableResult(result);

        expect(tableResult.targetCell).toEqual(activeCell);
        expect(tableResult.table.serialize()).toEqual(headerOnlyTableMarkdown);
    });

    it.each([
        { section: 'body', row: -1, col: 1 },
        { section: 'body', row: 5, col: 1 },
    ] satisfies CellCoords[])('preserves target and table when deleting an invalid body row %#', (activeCell) => {
        const result = apply(tableMarkdown, activeCell, { type: 'deleteRow' });
        const tableResult = expectTableResult(result);

        expect(tableResult.targetCell).toEqual(activeCell);
        expect(tableResult.table.serialize()).toEqual(tableMarkdown);
    });

    it('deletes the table when deleting the only column', () => {
        const singleColumnTableMarkdown = ['| H1 |', '| --- |', '| A1 |'].join('\n');
        const activeCell = { section: 'body', row: 0, col: 0 } satisfies CellCoords;

        const result = apply(singleColumnTableMarkdown, activeCell, { type: 'deleteColumn' });

        expect(result).toEqual({ kind: 'deleteTable' });
    });

    it('targets the column that shifts into the deleted column visual space', () => {
        const activeCell = { section: 'body', row: 0, col: 1 } satisfies CellCoords;

        const result = apply(['| H1 | H2 | H3 |', '| --- | --- | --- |', '| A1 | A2 | A3 |'].join('\n'), activeCell, {
            type: 'deleteColumn',
        });
        const tableResult = expectTableResult(result);

        expect(tableResult.targetCell).toEqual({ section: 'body', row: 0, col: 1 });
    });

    it('targets the column to the left when deleting the last column', () => {
        const activeCell = { section: 'body', row: 0, col: 1 } satisfies CellCoords;

        const result = apply(['| H1 | H2 |', '| --- | --- |', '| A1 | A2 |'].join('\n'), activeCell, {
            type: 'deleteColumn',
        });
        const tableResult = expectTableResult(result);

        expect(tableResult.targetCell).toEqual({ section: 'body', row: 0, col: 0 });
    });

    it.each([
        { section: 'body', row: 0, col: -1 },
        { section: 'body', row: 0, col: 5 },
    ] satisfies CellCoords[])('preserves target and table when deleting an invalid column %#', (activeCell) => {
        const result = apply(tableMarkdown, activeCell, { type: 'deleteColumn' });
        const tableResult = expectTableResult(result);

        expect(tableResult.targetCell).toEqual(activeCell);
        expect(tableResult.table.serialize()).toEqual(tableMarkdown);
    });

    it('deletes the table for an explicit deleteTable command', () => {
        const result = apply(tableMarkdown, { section: 'body', row: 0, col: 0 }, { type: 'deleteTable' });

        expect(result).toEqual({ kind: 'deleteTable' });
    });

    it.each(['left', 'center', 'right', null] satisfies TableAlignment[])(
        'preserves target cell for alignment %s',
        (alignment) => {
            const activeCell = { section: 'body', row: 0, col: 1 } satisfies CellCoords;
            const result = apply(tableMarkdown, activeCell, { type: 'alignColumn', alignment });
            const tableResult = expectTableResult(result);

            expect(tableResult.targetCell).toEqual(activeCell);
        }
    );
});
