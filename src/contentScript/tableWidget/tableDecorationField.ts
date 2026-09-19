import { EditorState, RangeSetBuilder, StateField, type Transaction } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import { logger } from '../../logger';
import { clearActiveCellEffect, getActiveCell } from '../tableState/activeCellState';
import { getCellRange, type TableCellRanges } from '../tableModel/markdownTableCellRanges';
import type { TableContext } from '../tableModel/tableContext';
import { classifyActiveCellChanges } from '../tableRuntime/activeCell/activeCellChangeScope';
import { getResolvedActiveCell, type ResolvedActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import { tableContextField, type TableIndex } from '../tableState/tableContextField';
import { TableWidget } from './TableWidget';
import { decideTableDecorationUpdate } from './tableDecorationPolicy';

interface TableDecorationState {
    decorations: DecorationSet;
    /** A document change rebuilt or dropped the previously active table's decoration. */
    activeHostInvalidated: boolean;
}

/**
 * Build decorations for all tables in the index, substituting a preserved active-table
 * decoration when one is given. An incomplete index has no tables, so it builds none.
 * Tables are always rendered as widgets - editing happens via nested cell editors.
 */
function buildTableDecorations(
    state: EditorState,
    activeHostInvalidated = false,
    preserved: PreservedActiveDecoration | null = null
): TableDecorationState {
    const decorations = new RangeSetBuilder<Decoration>();
    // RangeSetBuilder requires ranges in ascending document order, which the index guarantees.
    for (const context of state.field(tableContextField).tables) {
        const decoration =
            preserved?.context === context
                ? preserved.decoration
                : Decoration.replace({ widget: new TableWidget(context), block: true });
        decorations.add(context.from, context.to, decoration);
    }

    return { decorations: decorations.finish(), activeHostInvalidated };
}

function hasSameTableShape(before: TableCellRanges, after: TableCellRanges): boolean {
    return (
        before.headers.length === after.headers.length &&
        before.rows.length === after.rows.length &&
        before.rows.every((row, index) => row.length === after.rows[index]?.length)
    );
}

function findExactDecoration(decorations: DecorationSet, from: number, to: number): Decoration | null {
    let found: Decoration | null = null;
    decorations.between(from, to, (rangeFrom, rangeTo, decoration) => {
        if (rangeFrom === from && rangeTo === to) {
            found = decoration;
        }
    });
    return found;
}

interface PreservedActiveDecoration {
    context: TableContext;
    decoration: Decoration;
}

/** Cell switches keep the table host; the nested editor controller refreshes the departing cell. */
function getPreservedActiveTableDecoration(
    value: TableDecorationState,
    transaction: Transaction,
    previousCell: ResolvedActiveCell,
    index: TableIndex
): PreservedActiveDecoration | null {
    const scope = classifyActiveCellChanges(transaction.changes, previousCell);
    if (
        scope === 'touchesTable' ||
        (scope === 'outsideTable' && (transaction.isUserEvent('undo') || transaction.isUserEvent('redo'))) ||
        transaction.effects.some((effect) => effect.is(clearActiveCellEffect))
    ) {
        return null;
    }

    const mappedTableFrom = transaction.changes.mapPos(previousCell.tableFrom, 1);
    const mappedTableTo = transaction.changes.mapPos(previousCell.tableTo, -1);
    const activeCell = getActiveCell(transaction.state);
    if (!activeCell || activeCell.tableFrom !== mappedTableFrom) {
        return null;
    }

    const context = index.tables.find((table) => table.from === mappedTableFrom && table.to === mappedTableTo);
    if (
        !context ||
        !hasSameTableShape(previousCell.ctx.cellRanges, context.cellRanges) ||
        !getCellRange(context.cellRanges, activeCell)
    ) {
        return null;
    }

    const mappedDecorations = value.decorations.map(transaction.changes);
    const decoration = findExactDecoration(mappedDecorations, mappedTableFrom, mappedTableTo);
    return decoration ? { context, decoration } : null;
}

function reconcileTableDecorations(
    value: TableDecorationState,
    transaction: Transaction,
    previousCell: ResolvedActiveCell | null,
    docChangedWithActiveCell: boolean
): TableDecorationState {
    const index = transaction.state.field(tableContextField);

    // Nothing the projection depends on changed: same index, and the same active cell, so a
    // preserved active host stays preserved. Both fields keep their value identity when unchanged,
    // while parser recovery, clears, and activation effects all produce new values. The start
    // state lacks the index when the fields are registered by this transaction.
    if (
        !transaction.docChanged &&
        index === transaction.startState.field(tableContextField, false) &&
        getActiveCell(transaction.state) === getActiveCell(transaction.startState)
    ) {
        return value.activeHostInvalidated ? { ...value, activeHostInvalidated: false } : value;
    }

    const preserved = previousCell ? getPreservedActiveTableDecoration(value, transaction, previousCell, index) : null;
    return buildTableDecorations(transaction.state, docChangedWithActiveCell && !preserved, preserved);
}

/**
 * StateField that manages table widget decorations.
 * Block decorations MUST be provided via StateField, not ViewPlugin.
 * Tables are always rendered as widgets (unless source mode is toggled).
 */
export const tableDecorationField = StateField.define<TableDecorationState>({
    create(state) {
        logger.info('Table decoration field initialized');
        return buildTableDecorations(state);
    },
    update(value, transaction) {
        const previousCell = getResolvedActiveCell(transaction.startState);
        // A document change invalidates the previously active host unless reconciliation preserves it.
        const docChangedWithActiveCell = transaction.docChanged && previousCell !== null;
        const decision = decideTableDecorationUpdate(transaction);

        switch (decision.type) {
            case 'noneDecorations':
                return { decorations: Decoration.none, activeHostInvalidated: docChangedWithActiveCell };
            case 'rebuildAllDecorations':
                return buildTableDecorations(transaction.state, docChangedWithActiveCell);
            case 'reconcileDecorations':
                return reconcileTableDecorations(value, transaction, previousCell, docChangedWithActiveCell);
        }
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/** True when this state's transaction invalidated the previously active table's host. */
export function wasActiveHostInvalidated(state: EditorState): boolean {
    return state.field(tableDecorationField, false)?.activeHostInvalidated ?? false;
}
