import { EditorState, RangeSetBuilder, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import { logger } from '../../logger';
import { clearActiveCellEffect } from '../tableState/activeCellState';
import { tableContextField } from '../tableState/tableContextField';
import { rebuildAllTableWidgetsEffect, rebuildTableWidgetsEffect } from '../tableState/tableWidgetEffects';
import { TableWidget } from './TableWidget';
import { decideTableDecorationUpdate } from './tableDecorationPolicy';

interface TableDecorationState {
    decorations: DecorationSet;
    /** True when table widgets are displayed at the current index spans. */
    rendering: boolean;
}

/**
 * Build decorations for all tables in the document.
 * Tables are always rendered as widgets - editing happens via nested cell editors.
 */
function buildTableDecorations(state: EditorState): TableDecorationState {
    const index = state.field(tableContextField);
    if (index.treeIncomplete) {
        return { decorations: Decoration.none, rendering: false };
    }

    const decorations = new RangeSetBuilder<Decoration>();
    for (const ctx of index.tables) {
        // RangeSetBuilder requires ranges in ascending document order.
        const widget = new TableWidget(ctx.table, ctx.cellRanges, ctx.text, ctx.from);
        const decoration = Decoration.replace({
            widget,
            block: true,
        });

        decorations.add(ctx.from, ctx.to, decoration);
    }

    return { decorations: decorations.finish(), rendering: true };
}

function hasExplicitInvalidation(transaction: Parameters<typeof decideTableDecorationUpdate>[0]): boolean {
    return transaction.effects.some(
        (effect) =>
            effect.is(clearActiveCellEffect) ||
            effect.is(rebuildTableWidgetsEffect) ||
            effect.is(rebuildAllTableWidgetsEffect)
    );
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
        const decision = decideTableDecorationUpdate(transaction);

        switch (decision.type) {
            case 'noneDecorations':
                return { decorations: Decoration.none, rendering: false };
            case 'keepDecorations':
                if (transaction.state.field(tableContextField).treeIncomplete) {
                    return value;
                }
                // A start state without the index is the registration transaction itself: Joplin
                // appends the plugin configuration to an existing editor, and a host transaction
                // extender can force the provisional state before the index exists. Build once.
                // `value.rendering` deliberately does not force a rebuild here, so the paths that
                // dropped decorations on purpose keep them dropped until they ask for them back.
                if (transaction.startState.field(tableContextField, false)?.treeIncomplete ?? true) {
                    return buildTableDecorations(transaction.state);
                }
                return value;
            case 'mapDecorations':
                return {
                    decorations: value.decorations.map(transaction.changes),
                    rendering: value.rendering,
                };
            case 'rebuildAllDecorations':
                if (
                    transaction.state.field(tableContextField).treeIncomplete &&
                    !hasExplicitInvalidation(transaction)
                ) {
                    return {
                        decorations: value.decorations.map(transaction.changes),
                        rendering: value.rendering,
                    };
                }
                return buildTableDecorations(transaction.state);
        }
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/** True when table widgets are currently being rendered at the index's spans. */
export function isTableRenderingActive(state: EditorState): boolean {
    return state.field(tableDecorationField, false)?.rendering ?? false;
}
