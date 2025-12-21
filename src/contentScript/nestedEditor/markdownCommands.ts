import { EditorSelection, StateCommand, Transaction, StateField } from '@codemirror/state';
import { SubviewCellRange } from './transactionPolicy';

export function selectAllInCell(rangeField: StateField<SubviewCellRange>): StateCommand {
    return ({ state, dispatch }) => {
        const { from, to } = state.field(rangeField);
        dispatch(
            state.update({
                selection: EditorSelection.single(from, to),
                scrollIntoView: true,
                annotations: Transaction.userEvent.of('select.all'),
            })
        );
        return true;
    };
}
