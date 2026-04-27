import { MarkdownTable, type TableAlignment } from '../tableModel/MarkdownTable';
import {
    applyStructuralTableCommand,
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

        expect(result.table.serialize()).toContain('|  |  |');
        expect(result.targetCell).toEqual(targetCell);
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

        expect(result.table.serialize()).toContain('|  |  |');
        expect(result.targetCell).toEqual(targetCell);
    });

    it('supports a caller-provided target column for inserted rows', () => {
        const result = apply(
            tableMarkdown,
            { section: 'body', row: 1, col: 1 },
            { type: 'insertRowAfter', targetCol: 0 }
        );

        expect(result.targetCell).toEqual({ section: 'body', row: 2, col: 0 });
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

        expect(result.targetCell).toEqual(targetCell);
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

            expect(result.targetCell).toEqual(targetCell);
        }
    );

    it.each([
        ['moveColumnLeft', { section: 'body', row: 0, col: 0 }],
        ['moveColumnRight', { section: 'body', row: 0, col: 1 }],
    ] satisfies Array<[StructuralTableCommandId, CellCoords]>)(
        'preserves the active target for no-op column moves %s',
        (type, activeCell) => {
            const result = apply(tableMarkdown, activeCell, { type });

            expect(result.targetCell).toEqual(activeCell);
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

            expect(result.targetCell).toEqual(targetCell);
        }
    );

    it.each([
        ['clearTable', { section: 'header', row: 0, col: 0 }],
        ['clearRow', { section: 'body', row: 1, col: 1 }],
        ['clearColumn', { section: 'body', row: 0, col: 1 }],
    ] satisfies Array<[StructuralTableCommandId, CellCoords]>)('preserves target cell for %s', (type, activeCell) => {
        const result = apply(tableMarkdown, activeCell, { type });

        expect(result.targetCell).toEqual(activeCell);
    });

    it.each(['left', 'center', 'right', null] satisfies TableAlignment[])(
        'preserves target cell for alignment %s',
        (alignment) => {
            const activeCell = { section: 'body', row: 0, col: 1 } satisfies CellCoords;
            const result = apply(tableMarkdown, activeCell, { type: 'alignColumn', alignment });

            expect(result.targetCell).toEqual(activeCell);
        }
    );
});
