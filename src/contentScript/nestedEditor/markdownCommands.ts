import { EditorSelection, StateCommand, Transaction, StateField } from '@codemirror/state';
import { SubviewCellRange } from './transactionPolicy';

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
            const len = delimiter.length;

            // Case 1: Detect delimiters OUTSIDE the selection (e.g. selection is "foo" in "**foo**")
            const before = doc.sliceString(rangeFrom - len, rangeFrom);
            const after = doc.sliceString(rangeTo, rangeTo + len);
            const isWrappedOutside = before === delimiter && after === delimiter;

            if (isWrappedOutside) {
                return {
                    changes: [
                        { from: rangeFrom - len, to: rangeFrom, insert: '' },
                        { from: rangeTo, to: rangeTo + len, insert: '' },
                    ],
                    range: EditorSelection.range(rangeFrom - len, rangeTo - len),
                };
            }

            // Case 2: Detect delimiters INSIDE the selection (e.g. selection is "**foo**")
            const startInside = doc.sliceString(rangeFrom, rangeFrom + len);
            const endInside = doc.sliceString(rangeTo - len, rangeTo);
            const isWrappedInside =
                startInside === delimiter && endInside === delimiter && rangeTo - rangeFrom >= 2 * len;

            if (isWrappedInside) {
                return {
                    changes: [
                        { from: rangeFrom, to: rangeFrom + len, insert: '' },
                        { from: rangeTo - len, to: rangeTo, insert: '' },
                    ],
                    // We shrink the selection to just the content
                    range: EditorSelection.range(rangeFrom, rangeTo - 2 * len),
                };
            }

            // Default: Wrap
            return {
                changes: [
                    { from: rangeFrom, insert: delimiter },
                    { from: rangeTo, insert: delimiter },
                ],
                range: EditorSelection.range(rangeFrom + len, rangeTo + len),
            };
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
