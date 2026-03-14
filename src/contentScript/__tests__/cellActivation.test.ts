import { computeMarkdownTableCellRanges } from '../tableModel/markdownTableCellRanges';
import { resolveActivationTargetCell } from '../tableWidget/cellActivation';
import type { ActiveCell } from '../tableWidget/activeCellState';

const tableText = ['| H1 | H2 |', '| --- | --- |', '| aaa bbb ccc | zzz |'].join('\n');

function requireCellRanges() {
    const ranges = computeMarkdownTableCellRanges(tableText);
    if (!ranges) {
        throw new Error('Expected table ranges');
    }
    return ranges;
}

describe('resolveActivationTargetCell', () => {
    it('keeps the current active cell when the cursor lands on table punctuation', () => {
        const activeCell: ActiveCell = {
            anchorPos: tableText.indexOf('aaa'),
            tableFrom: 0,
            section: 'body',
            row: 0,
            col: 0,
        };
        const pipePos = tableText.indexOf('| zzz');

        expect(
            resolveActivationTargetCell({
                tableFrom: 0,
                relativePos: pipePos,
                cellRanges: requireCellRanges(),
                activeCell,
            })
        ).toEqual({
            section: 'body',
            row: 0,
            col: 0,
        });
    });

    it('falls back to the first body cell when there is no current active cell', () => {
        const pipePos = tableText.indexOf('| zzz');

        expect(
            resolveActivationTargetCell({
                tableFrom: 0,
                relativePos: pipePos,
                cellRanges: requireCellRanges(),
                activeCell: null,
            })
        ).toEqual({
            section: 'body',
            row: 0,
            col: 0,
        });
    });
});
