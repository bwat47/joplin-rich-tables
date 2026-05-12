import { EditorState, RangeSetBuilder, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView } from '@codemirror/view';
import { logger } from '../../logger';
import { hashTableText } from '../shared/hashUtils';
import { buildTableContext } from '../tableModel/tableContext';
import { findTableRanges } from '../tableRuntime/tableResolution';
import { TableWidget } from './TableWidget';
import { decideTableDecorationUpdate } from './tableDecorationPolicy';

/**
 * Build decorations for all tables in the document.
 * Tables are always rendered as widgets - editing happens via nested cell editors.
 */
function buildTableDecorations(state: EditorState): DecorationSet {
    const decorations = new RangeSetBuilder<Decoration>();
    const tables = findTableRanges(state);

    for (const table of tables) {
        // RangeSetBuilder requires ranges in ascending document order.
        const ctx = buildTableContext(table);
        if (!ctx) {
            continue;
        }

        const contentHash = hashTableText(table.text);

        const widget = new TableWidget(ctx.table, ctx.cellRanges, table.text, table.from, table.to, contentHash);
        const decoration = Decoration.replace({
            widget,
            block: true,
        });

        decorations.add(table.from, table.to, decoration);
    }

    return decorations.finish();
}

/**
 * StateField that manages table widget decorations.
 * Block decorations MUST be provided via StateField, not ViewPlugin.
 * Tables are always rendered as widgets (unless source mode is toggled).
 */
export const tableDecorationField = StateField.define<DecorationSet>({
    create(state) {
        logger.info('Table decoration field initialized');
        return buildTableDecorations(state);
    },
    update(decorations, transaction) {
        const decision = decideTableDecorationUpdate(transaction);

        switch (decision.type) {
            case 'noneDecorations':
                return Decoration.none;
            case 'keepDecorations':
                return decorations;
            case 'mapDecorations':
                return decorations.map(transaction.changes);
            case 'rebuildAllDecorations':
                return buildTableDecorations(transaction.state);
        }
    },
    provide: (field) => EditorView.decorations.from(field),
});
