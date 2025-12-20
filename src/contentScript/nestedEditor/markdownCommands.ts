import { EditorSelection, StateCommand, Transaction } from '@codemirror/state';

/**
 * Helper to toggle a markdown delimiter around the selection.
 * Handles both wrapping and unwrapping (if already wrapped).
 */
function toggleWrapper(delimiter: string): StateCommand {
    return ({ state, dispatch }) => {
        const changes = state.changeByRange((range) => {
            const rangeFrom = range.from;
            const rangeTo = range.to;
            const doc = state.doc;

            // Check if the selection is already wrapped by the delimiter
            const startStr = doc.sliceString(rangeFrom - delimiter.length, rangeFrom);
            const endStr = doc.sliceString(rangeTo, rangeTo + delimiter.length);
            const isWrapped = startStr === delimiter && endStr === delimiter;

            if (isWrapped) {
                // Unwrap
                return {
                    changes: [
                        { from: rangeFrom - delimiter.length, to: rangeFrom, insert: '' },
                        { from: rangeTo, to: rangeTo + delimiter.length, insert: '' },
                    ],
                    range: EditorSelection.range(rangeFrom - delimiter.length, rangeTo - delimiter.length),
                };
            } else {
                // Wrap
                return {
                    changes: [
                        { from: rangeFrom, insert: delimiter },
                        { from: rangeTo, insert: delimiter },
                    ],
                    range: EditorSelection.range(rangeFrom + delimiter.length, rangeTo + delimiter.length),
                };
            }
        });

        dispatch(
            state.update(changes, {
                scrollIntoView: true,
                annotations: Transaction.userEvent.of('input'),
            })
        );
        return true;
    };
}

export const toggleBold: StateCommand = toggleWrapper('**');
export const toggleItalic: StateCommand = toggleWrapper('*');
export const toggleStrikethrough: StateCommand = toggleWrapper('~~');
export const toggleInlineCode: StateCommand = toggleWrapper('`');
