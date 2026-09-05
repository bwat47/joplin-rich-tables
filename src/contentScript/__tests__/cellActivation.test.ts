import { resolveActivationTargetCell } from '../tableRuntime/activeCell/cellActivation';
import type { ActiveCell } from '../tableState/activeCellState';
import { parseCellRangesFixture } from './testUtils';

const tableText = ['| H1 | H2 |', '| --- | --- |', '| aaa bbb ccc | zzz |'].join('\n');

describe('resolveActivationTargetCell', () => {
    it('keeps the current active cell when the cursor lands on table punctuation', () => {
        const activeCell: ActiveCell = {
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
                cellRanges: parseCellRangesFixture(tableText),
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
                cellRanges: parseCellRangesFixture(tableText),
                activeCell: null,
            })
        ).toEqual({
            section: 'body',
            row: 0,
            col: 0,
        });
    });
});
