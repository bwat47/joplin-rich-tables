import {
    Annotation,
    ChangeSet,
    EditorSelection,
    EditorState,
    Extension,
    StateEffect,
    StateField,
    Transaction,
} from '@codemirror/state';

/** Annotation used to mark transactions synchronization transactions to prevent loops. */
export const syncAnnotation = Annotation.define<boolean>();

/** Tracks the current start/end positions of the active cell in the document. */
export interface SubviewCellRange {
    from: number;
    to: number;
}

export const setSubviewCellRangeEffect = StateEffect.define<SubviewCellRange>();

/** Creates a StateField that tracks the cell range, mapping it through document changes. */
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

/** Escapes any pipe characters in the text that aren't already escaped. */
export function escapeUnescapedPipes(text: string): string {
    return escapeUnescapedPipesWithContext(text, 0);
}

export function escapeUnescapedPipesWithContext(text: string, precedingBackslashes: number): string {
    // Escape any '|' that is not already escaped as '\|'.
    // A pipe is considered escaped only when preceded by an odd-length backslash run.
    // Example: `\\|` (two backslashes + pipe) is NOT escaped in Markdown (the pipe is active).
    let result = '';
    let backslashRun = precedingBackslashes;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '\\') {
            result += ch;
            backslashRun++;
            continue;
        }

        if (ch === '|') {
            const isAlreadyEscaped = backslashRun % 2 === 1;
            result += isAlreadyEscaped ? '|' : '\\|';
            backslashRun = 0;
            continue;
        }

        result += ch;
        backslashRun = 0;
    }

    return result;
}

export function countTrailingBackslashesInDoc(doc: EditorState['doc'], pos: number): number {
    let count = 0;
    for (let i = pos - 1; i >= 0; i--) {
        if (doc.sliceString(i, i + 1) !== '\\') {
            break;
        }
        count++;
    }
    return count;
}

/** Converts CR/LF newlines to `<br>` to keep table cells single-line in Markdown. */
export function convertNewlinesToBr(text: string): string {
    // Normalize CRLF/CR to LF first, then replace each LF with <br>.
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '<br>');
}

/** Clamps a value between min and max. */
export function clamp(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, n));
}

/**
 * Creates a transaction filter that enforces cell boundaries and table syntax.
 * Rejects newlines and escapes unescaped pipes.
 */
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

        const clampSelectionToBounds = (selection: EditorSelection, from: number, to: number): EditorSelection => {
            const boundedRanges = selection.ranges.map((range) => {
                const anchor = clamp(range.anchor, from, to);
                const head = clamp(range.head, from, to);
                return EditorSelection.range(anchor, head);
            });
            return EditorSelection.create(boundedRanges, selection.mainIndex);
        };

        const mapSelectionWithAssoc = (
            selection: EditorSelection,
            changes: ChangeSet,
            assoc: number
        ): EditorSelection => {
            const mappedRanges = selection.ranges.map((range) => {
                const anchor = changes.mapPos(range.anchor, assoc);
                const head = changes.mapPos(range.head, assoc);
                return EditorSelection.range(anchor, head);
            });
            return EditorSelection.create(mappedRanges, selection.mainIndex);
        };

        if (!tr.docChanged) {
            // Selection-only transaction.
            if (!tr.selection) {
                return tr;
            }
            const selectionSpec = clampSelectionToBounds(tr.selection, cellFrom, cellTo);
            return { selection: selectionSpec };
        }

        type SimpleChange = { from: number; to: number; insert: string };

        let rejected = false;
        let didModifyInserts = false;
        const nextChanges: SimpleChange[] = [];

        tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
            if (fromA < cellFrom || toA > cellTo) {
                rejected = true;
                return;
            }

            const insertedText = inserted.toString();

            // Markdown tables can't contain literal newlines inside a cell without breaking the table.
            // Instead of rejecting multi-line pastes, sanitize them into inline HTML.
            let sanitizedText = insertedText;
            if (sanitizedText.includes('\n') || sanitizedText.includes('\r')) {
                sanitizedText = convertNewlinesToBr(sanitizedText);
            }

            const escaped = sanitizedText.includes('|')
                ? escapeUnescapedPipesWithContext(
                      sanitizedText,
                      countTrailingBackslashesInDoc(tr.startState.doc, fromA)
                  )
                : sanitizedText;
            if (escaped !== insertedText) {
                didModifyInserts = true;
            }

            nextChanges.push({ from: fromA, to: toA, insert: escaped });
        });

        if (rejected) {
            return [];
        }

        // Selection handling:
        // - If we changed inserted text length (e.g. `|` -> `\|`, `\n` -> `<br>`),
        //   we must also update the selection so the caret ends up after the inserted content.
        // - For unmodified changes, CodeMirror's normal selection mapping is fine; we only clamp.
        let selectionSpec: EditorSelection | undefined;
        if (didModifyInserts) {
            const changeSet = ChangeSet.of(nextChanges, tr.startState.doc.length);
            const newCellFrom = changeSet.mapPos(cellFrom, -1);
            const newCellTo = changeSet.mapPos(cellTo, 1);

            // If the user is replacing a single selection range with a single change,
            // put the caret after the inserted text.
            const main = tr.startState.selection.main;
            if (
                !main.empty &&
                nextChanges.length === 1 &&
                nextChanges[0].from === main.from &&
                nextChanges[0].to === main.to &&
                typeof nextChanges[0].insert === 'string'
            ) {
                const insertedLength = nextChanges[0].insert.length;
                selectionSpec = EditorSelection.single(nextChanges[0].from + insertedLength);
                selectionSpec = clampSelectionToBounds(selectionSpec, newCellFrom, newCellTo);
            } else {
                // Map the *pre-change* selection through the rewritten changes.
                // Use assoc=1 so positions at insert boundaries end up *after* inserted content.
                const mappedSelection = mapSelectionWithAssoc(tr.startState.selection, changeSet, 1);
                selectionSpec = clampSelectionToBounds(mappedSelection, newCellFrom, newCellTo);
            }
        } else if (tr.selection) {
            const newCellFrom = tr.changes.mapPos(cellFrom, -1);
            const newCellTo = tr.changes.mapPos(cellTo, 1);
            selectionSpec = clampSelectionToBounds(tr.selection, newCellFrom, newCellTo);
        }

        // If we didn't modify inserts and selection is unchanged, keep transaction.
        if (!didModifyInserts && !selectionSpec) {
            return tr;
        }

        return {
            changes: didModifyInserts ? nextChanges : tr.changes,
            ...(selectionSpec ? { selection: selectionSpec } : null),
        };
    });
}

/** Creates an extension that disables history for local transactions (history is managed by main editor). */
export function createHistoryExtender(): Extension {
    return EditorState.transactionExtender.of((tr) => {
        // Ensure local transactions don't build history. Main editor owns history.
        if (tr.annotation(syncAnnotation)) {
            return null;
        }
        return { annotations: Transaction.addToHistory.of(false) };
    });
}
