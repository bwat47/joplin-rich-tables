import { computeCellAnchorForTable } from '../tableModel/cellAnchors';
import { MarkdownTable } from '../tableModel/MarkdownTable';

describe('computeCellAnchorForTable', () => {
    it('falls back to the header cell when the table has no body rows left', () => {
        const serialized = MarkdownTable.fromParts({
            headerCells: ['H1', 'H2'],
            alignments: [null, null],
            bodyRows: [],
        }).serializeWithOffsets();

        const anchor = computeCellAnchorForTable({
            serialized,
            target: { section: 'body', row: 0, col: 1 },
        });

        expect(anchor).toEqual({
            section: 'header',
            row: 0,
            col: 1,
            anchorOffset: serialized.text.indexOf('H2'),
        });
    });
});
