import { Transaction } from '@codemirror/state';

/**
 * Checks if a string contains an unescaped pipe character.
 * An unescaped pipe is one not preceded by an odd number of backslashes.
 */
export function hasUnescapedPipe(text: string): boolean {
    let backslashRun = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '\\') {
            backslashRun++;
            continue;
        }
        if (ch === '|') {
            // Pipe is escaped only if preceded by odd number of backslashes
            if (backslashRun % 2 === 0) {
                return true;
            }
        }
        backslashRun = 0;
    }
    return false;
}

/**
 * Detects if a transaction represents a structural table change (row/column add/delete).
 * Structural changes are identified by:
 * - Newlines being inserted or deleted (row changes)
 * - Unescaped pipes being inserted or deleted (column changes)
 *
 * @param tr - The transaction to check
 * @returns true if the transaction contains structural table changes
 */
export function isStructuralTableChange(tr: Transaction): boolean {
    let isStructural = false;
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        const deletedText = tr.startState.doc.sliceString(fromA, toA);
        const insertedText = inserted.toString();
        // Newlines indicate row changes; unescaped pipes indicate column changes
        if (
            deletedText.includes('\n') ||
            insertedText.includes('\n') ||
            hasUnescapedPipe(deletedText) ||
            hasUnescapedPipe(insertedText)
        ) {
            isStructural = true;
        }
    });
    return isStructural;
}
