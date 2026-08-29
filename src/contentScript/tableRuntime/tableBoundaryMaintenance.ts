import {
    ChangeSet,
    EditorState,
    Transaction,
    type Extension,
    type Line,
    type Text,
    type TransactionSpec,
} from '@codemirror/state';
import { syncAnnotation } from '../editorBridge/syncAnnotation';
import type { TableContext } from '../tableModel/tableContext';
import { changesOverlapRange } from '../shared/transactionUtils';
import { normalizeBeforeEditAnnotation } from './tableCanonicalForm';
import { resolveAdjacentTables } from './tableBoundaryResolution';
import { hasRequiredBlankLinesAfter, hasRequiredBlankLinesBefore, isBlankLineContent } from './tableBoundarySpacing';
import { hasPlainRenderedTableCaret } from './renderedTableCaret';

/** A newline inserted into the post-change document to restore a table's separation. */
interface BoundaryPadding {
    from: number;
    insert: string;
}

const BOUNDARY_PADDING_NEWLINE = '\n';

/**
 * Transactions this filter inspects: user input that is not already a plugin rewrite.
 *
 * Composition is excluded because rewriting the document mid-composition breaks IME and
 * soft-keyboard input; if composition fills the boundary, cell entry normalization repairs it later.
 * Deletions are excluded too - they are protected by `mainEditorTableEntry` instead, and
 * undo must be able to reach the document as the user last left it.
 */
function isBoundaryMaintenanceCandidate(transaction: Transaction): boolean {
    return (
        transaction.docChanged &&
        transaction.isUserEvent('input') &&
        !transaction.isUserEvent('input.type.compose') &&
        !transaction.annotation(syncAnnotation) &&
        !transaction.annotation(normalizeBeforeEditAnnotation) &&
        hasPlainRenderedTableCaret(transaction.startState)
    );
}

function insertsNonWhitespace(inserted: Text): boolean {
    return inserted.length > 0 && !isBlankLineContent(inserted.toString());
}

/**
 * Blank lines this transaction writes text into, in start-state coordinates.
 *
 * A table's separation is made of blank lines, so the only way an insertion can consume it
 * is by putting non-whitespace on one of them. Starting from the touched lines keeps table
 * resolution - which parses the table it finds - off the common keystroke path.
 */
function collectFilledBlankLines(transaction: Transaction): Line[] {
    const { doc } = transaction.startState;
    const lines = new Map<number, Line>();

    transaction.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        if (!insertsNonWhitespace(inserted)) {
            return;
        }
        for (const pos of fromA === toA ? [fromA] : [fromA, toA]) {
            const line = doc.lineAt(pos);
            if (isBlankLineContent(line.text)) {
                lines.set(line.from, line);
            }
        }
    });

    return [...lines.values()];
}

/** Tables separated from their neighbour by `line`. A blank line can sit between two. */
function resolveTablesSeparatedBy(state: EditorState, line: Line): TableContext[] {
    // The blank line's own breaks are the separation: one ends at its start, one begins at
    // its end, and a table edge sits directly against them.
    const { before, after } = resolveAdjacentTables(state, line.from - 1, line.to + 1);
    return [before, after].filter((ctx): ctx is TableContext => ctx !== null);
}

/**
 * Newlines this table needs once the transaction's changes are applied, or none.
 *
 * The decision is made against the post-change document rather than the input, so a rewrite
 * that already spaced the table - a table paste, or this filter's own padding for a
 * neighbouring table - cannot be padded twice.
 */
function resolveBoundaryPadding(transaction: Transaction, ctx: TableContext): BoundaryPadding[] {
    // An edit reaching into the table's own text is a table edit, not a boundary one.
    if (changesOverlapRange(transaction, ctx.from, ctx.to)) {
        return [];
    }

    const doc = transaction.newDoc;
    const from = transaction.changes.mapPos(ctx.from, 1);
    const to = transaction.changes.mapPos(ctx.to, -1);
    // Text merged onto a table's first or last line needs more than a blank line to undo;
    // cell entry normalization repairs that shape.
    if (doc.lineAt(from).from !== from || doc.lineAt(to).to !== to) {
        return [];
    }

    const padding: BoundaryPadding[] = [];
    if (!hasRequiredBlankLinesBefore(doc, from)) {
        padding.push({ from, insert: BOUNDARY_PADDING_NEWLINE });
    }
    if (!hasRequiredBlankLinesAfter(doc, to)) {
        padding.push({ from: to, insert: BOUNDARY_PADDING_NEWLINE });
    }
    return padding;
}

function collectBoundaryPadding(transaction: Transaction): BoundaryPadding[] {
    const state = transaction.startState;
    const tables = new Map<number, TableContext>();
    for (const line of collectFilledBlankLines(transaction)) {
        for (const ctx of resolveTablesSeparatedBy(state, line)) {
            tables.set(ctx.from, ctx);
        }
    }

    const padding = [...tables.values()].flatMap((ctx) => resolveBoundaryPadding(transaction, ctx));
    // `ChangeSet.of` reads a spec list as sequential once it runs backwards, so keep the
    // insertions in document order.
    return padding.sort((a, b) => a.from - b.from);
}

function buildPaddedTransaction(transaction: Transaction, padding: BoundaryPadding[]): readonly TransactionSpec[] {
    const changes = ChangeSet.of(padding, transaction.newDoc.length);
    // Keeping the original transaction as the first spec preserves all annotations and lets
    // CodeMirror map its effects through the sequential padding change.
    return [
        transaction,
        {
            changes,
            sequential: true,
            // Padding is always inserted on the far side of a table edge from the text that
            // was typed, so the caret keeps its place beside that text.
            selection: transaction.newSelection.map(changes, -1),
        },
    ];
}

/**
 * Restores the blank line a table needs when typing or pasting fills it in.
 *
 * The separation a table keeps from its neighbours is protected against deletion by
 * `mainEditorTableEntry` and repaired on cell entry by `tableCanonicalForm`; this closes the
 * remaining hole, where the user writes text into the blank line instead of removing it.
 * The padding is folded into the same transaction so the host never sees the unseparated
 * document, and one undo takes both back.
 */
const tableBoundaryMaintenanceFilter = EditorState.transactionFilter.of((transaction) => {
    if (!isBoundaryMaintenanceCandidate(transaction)) {
        return transaction;
    }

    const padding = collectBoundaryPadding(transaction);
    return padding.length ? buildPaddedTransaction(transaction, padding) : transaction;
});

export const tableBoundaryMaintenanceExtension: Extension = [tableBoundaryMaintenanceFilter];
