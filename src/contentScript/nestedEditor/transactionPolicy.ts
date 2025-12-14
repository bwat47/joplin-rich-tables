import {
    Annotation,
    ChangeSpec,
    EditorSelection,
    EditorState,
    Extension,
    StateEffect,
    StateField,
    Transaction,
} from '@codemirror/state';

export const syncAnnotation = Annotation.define<boolean>();

export interface SubviewCellRange {
    from: number;
    to: number;
}

export const setSubviewCellRangeEffect = StateEffect.define<SubviewCellRange>();

export function createSubviewCellRangeField(initial: SubviewCellRange): StateField<SubviewCellRange> {
    return StateField.define<SubviewCellRange>({
        create() {
            return initial;
        },
        update(value, tr) {
            for (const effect of tr.effects) {
                if (effect.is(setSubviewCellRangeEffect)) {
                    return effect.value;
                }
            }
            if (tr.docChanged) {
                // Use assoc=-1 for 'from' so insertions at start boundary stay visible.
                const mappedFrom = tr.changes.mapPos(value.from, -1);
                // Use assoc=1 for 'to' so insertions at end boundary stay visible.
                const mappedTo = tr.changes.mapPos(value.to, 1);
                return { from: mappedFrom, to: mappedTo };
            }
            return value;
        },
    });
}

export function escapeUnescapedPipes(text: string): string {
    // Escape any '|' that is not already escaped as '\|'.
    // This is intentionally simple and operates on the inserted text only.
    let result = '';
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '|') {
            const prev = i > 0 ? text[i - 1] : '';
            if (prev === '\\') {
                result += '|';
            } else {
                result += '\\|';
            }
        } else {
            result += ch;
        }
    }
    return result;
}

export function clamp(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, n));
}

export function createCellTransactionFilter(rangeField: StateField<SubviewCellRange>): Extension {
    return EditorState.transactionFilter.of((tr) => {
        if (!tr.docChanged && !tr.selection) {
            return tr;
        }

        // Allow main->subview sync transactions through untouched.
        if (tr.annotation(syncAnnotation)) {
            return tr;
        }

        const { from: cellFrom, to: cellTo } = tr.startState.field(rangeField);

        // Compute new bounds after changes for selection clamping.
        // The selection in the transaction is the NEW selection, so clamp to NEW bounds.
        const newCellFrom = tr.docChanged ? tr.changes.mapPos(cellFrom, -1) : cellFrom;
        const newCellTo = tr.docChanged ? tr.changes.mapPos(cellTo, 1) : cellTo;

        // Ensure selection stays in-bounds (using new bounds).
        let selectionSpec: EditorSelection | undefined;
        if (tr.selection) {
            const boundedRanges = tr.selection.ranges.map((range) => {
                const anchor = clamp(range.anchor, newCellFrom, newCellTo);
                const head = clamp(range.head, newCellFrom, newCellTo);
                return EditorSelection.range(anchor, head);
            });
            selectionSpec = EditorSelection.create(boundedRanges, tr.selection.mainIndex);
        }

        if (!tr.docChanged) {
            // Selection-only transaction.
            return selectionSpec ? { selection: selectionSpec } : tr;
        }

        let rejected = false;
        let needsPipeEscape = false;
        const nextChanges: ChangeSpec[] = [];

        tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
            if (fromA < cellFrom || toA > cellTo) {
                rejected = true;
                return;
            }

            const insertedText = inserted.toString();
            if (insertedText.includes('\n') || insertedText.includes('\r')) {
                rejected = true;
                return;
            }

            const escaped = insertedText.includes('|') ? escapeUnescapedPipes(insertedText) : insertedText;
            if (escaped !== insertedText) {
                needsPipeEscape = true;
            }

            nextChanges.push({ from: fromA, to: toA, insert: escaped });
        });

        if (rejected) {
            return [];
        }

        // If we didn't modify inserts and selection is unchanged, keep transaction.
        if (!needsPipeEscape && !selectionSpec) {
            return tr;
        }

        return {
            changes: nextChanges,
            ...(selectionSpec ? { selection: selectionSpec } : null),
        };
    });
}

export function createHistoryExtender(): Extension {
    return EditorState.transactionExtender.of((tr) => {
        // Ensure local transactions don't build history. Main editor owns history.
        if (tr.annotation(syncAnnotation)) {
            return null;
        }
        return { annotations: Transaction.addToHistory.of(false) };
    });
}
