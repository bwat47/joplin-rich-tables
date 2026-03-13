import { EditorSelection, StateCommand, Transaction } from '@codemirror/state';

export function selectAllInCell(): StateCommand {
    return ({ state, dispatch }) => {
        dispatch(
            state.update({
                selection: EditorSelection.single(0, state.doc.length),
                scrollIntoView: true,
                annotations: Transaction.userEvent.of('select.all'),
            })
        );
        return true;
    };
}
