import { type Transaction } from '@codemirror/state';
import { cellSelectionTransitionAnnotation } from '../../tableState/cellSelectionState';

export function hasCellSelectionTransitionAnnotation(transactions: readonly Transaction[]): boolean {
    return transactions.some((tr) => Boolean(tr.annotation(cellSelectionTransitionAnnotation)));
}
