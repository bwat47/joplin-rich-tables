import { type Transaction } from '@codemirror/state';
import { isFullDocumentReplace } from '../../shared/transactionUtils';
import { cellSelectionTransitionAnnotation } from '../../tableState/cellSelectionState';
import { normalizeBeforeEditAnnotation } from './tableNormalization';

export function hasNormalizeBeforeEditAnnotation(transactions: readonly Transaction[]): boolean {
    return transactions.some((tr) => tr.annotation(normalizeBeforeEditAnnotation));
}

export function hasCellSelectionTransitionAnnotation(transactions: readonly Transaction[]): boolean {
    return transactions.some((tr) => tr.annotation(cellSelectionTransitionAnnotation));
}

export function hasFullDocumentReplace(transactions: readonly Transaction[]): boolean {
    return transactions.some((tr) => isFullDocumentReplace(tr));
}
