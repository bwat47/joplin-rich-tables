import { EditorState, RangeSetBuilder, StateField, type Transaction } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import { logger } from '../../logger';
import { clearActiveCellEffect, getActiveCell, isSameActiveCell } from '../tableState/activeCellState';
import { getCellRange, type TableCellRanges } from '../tableModel/markdownTableCellRanges';
import type { TableContext } from '../tableModel/tableContext';
import { classifyActiveCellChanges } from '../tableRuntime/activeCell/activeCellChangeScope';
import { getResolvedActiveCell, type ResolvedActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import { triggerOpenCellRequestEffect } from '../tableRuntime/openCellRequest';
import { tableContextField, type TableIndex } from '../tableState/tableContextField';
import { TableWidget } from './TableWidget';
import { decideTableDecorationUpdate } from './tableDecorationPolicy';

interface TableDecorationState {
    decorations: DecorationSet;
    /** True when decorations project the complete index, even if it contains no tables. */
    rendering: boolean;
    /** A document change rebuilt or dropped the previously active table's decoration. */
    activeHostInvalidated: boolean;
}

/**
 * Build decorations for all tables in the document.
 * Tables are always rendered as widgets - editing happens via nested cell editors.
 */
function buildTableDecorations(state: EditorState, activeHostInvalidated = false): TableDecorationState {
    const index = state.field(tableContextField);
    if (index.treeIncomplete) {
        return { decorations: Decoration.none, rendering: false, activeHostInvalidated };
    }

    const decorations = new RangeSetBuilder<Decoration>();
    for (const ctx of index.tables) {
        // RangeSetBuilder requires ranges in ascending document order.
        const widget = new TableWidget(ctx);
        const decoration = Decoration.replace({
            widget,
            block: true,
        });

        decorations.add(ctx.from, ctx.to, decoration);
    }

    return { decorations: decorations.finish(), rendering: true, activeHostInvalidated };
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

function hasActivationInvalidation(transaction: Transaction): boolean {
    return transaction.effects.some(
        (effect) => effect.is(clearActiveCellEffect) || effect.is(triggerOpenCellRequestEffect)
    );
}

interface PreservedActiveDecoration {
    context: TableContext;
    decoration: Decoration;
}

function getPreservedActiveDecoration(
    value: TableDecorationState,
    transaction: Transaction,
    previousCell: ResolvedActiveCell,
    index: TableIndex
): PreservedActiveDecoration | null {
    const scope = classifyActiveCellChanges(transaction.changes, previousCell);
    if (
        scope === 'touchesTable' ||
        (scope === 'outsideTable' && (transaction.isUserEvent('undo') || transaction.isUserEvent('redo'))) ||
        hasActivationInvalidation(transaction)
    ) {
        return null;
    }

    const mappedTableFrom = transaction.changes.mapPos(previousCell.tableFrom, 1);
    const mappedTableTo = transaction.changes.mapPos(previousCell.tableTo, -1);
    const expectedActiveCell = { ...previousCell.activeCell, tableFrom: mappedTableFrom };
    if (!isSameActiveCell(expectedActiveCell, getActiveCell(transaction.state))) {
        return null;
    }

    const context = index.tables.find((table) => table.from === mappedTableFrom && table.to === mappedTableTo);
    if (
        !context ||
        !hasSameTableShape(previousCell.ctx.cellRanges, context.cellRanges) ||
        !getCellRange(context.cellRanges, previousCell.activeCell)
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
    previousCell: ResolvedActiveCell | null
): TableDecorationState {
    const index = transaction.state.field(tableContextField);
    const invalidated = transaction.docChanged && previousCell !== null;

    // A full replacement deliberately leaves widgets absent until the lifecycle's deferred
    // rebuild. Ordinary selection/effect-free transactions in that window must not resurrect
    // them. Parser recovery is different: its start-state index is incomplete.
    if (
        !value.rendering &&
        !transaction.docChanged &&
        !transaction.startState.field(tableContextField).treeIncomplete
    ) {
        return { ...value, activeHostInvalidated: false };
    }

    if (index.treeIncomplete) {
        return buildTableDecorations(transaction.state, invalidated);
    }

    const preserved = previousCell ? getPreservedActiveDecoration(value, transaction, previousCell, index) : null;
    const decorations = new RangeSetBuilder<Decoration>();
    for (const context of index.tables) {
        const decoration =
            preserved?.context === context
                ? preserved.decoration
                : Decoration.replace({ widget: new TableWidget(context), block: true });
        decorations.add(context.from, context.to, decoration);
    }

    return {
        decorations: decorations.finish(),
        rendering: true,
        activeHostInvalidated: invalidated && !preserved,
    };
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
        const activeHostInvalidated = transaction.docChanged && previousCell !== null;
        const decision = decideTableDecorationUpdate(transaction);

        switch (decision.type) {
            case 'noneDecorations':
                return { decorations: Decoration.none, rendering: false, activeHostInvalidated };
            case 'rebuildAllDecorations':
                return buildTableDecorations(transaction.state, activeHostInvalidated);
            case 'reconcileDecorations':
                return reconcileTableDecorations(value, transaction, previousCell);
        }
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/** True when decorations project the complete index; false in raw mode or while rendering is deferred. */
export function isTableRenderingActive(state: EditorState): boolean {
    return state.field(tableDecorationField, false)?.rendering ?? false;
}

/** True when this state's transaction invalidated the previously active table's host. */
export function wasActiveHostInvalidated(state: EditorState): boolean {
    return state.field(tableDecorationField, false)?.activeHostInvalidated ?? false;
}
