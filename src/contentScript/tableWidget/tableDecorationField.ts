import { EditorState, Range, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView } from '@codemirror/view';
import { logger } from '../../logger';
import { documentDefinitionsField } from '../services/documentDefinitions';
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
    const decorations: Range<Decoration>[] = [];
    const tables = findTableRanges(state);
    const definitions = state.field(documentDefinitionsField);

    for (const table of tables) {
        const ctx = buildTableContext(table);
        if (!ctx) {
            continue;
        }

        // Content hash includes definition block so widgets rebuild when definitions change.
        const contentHash = hashTableText(table.text + definitions.definitionBlock);

        const widget = new TableWidget(
            ctx.table,
            ctx.cellRanges,
            table.text,
            table.from,
            table.to,
            definitions.definitionBlock,
            contentHash
        );
        const decoration = Decoration.replace({
            widget,
            block: true,
        });

        decorations.push(decoration.range(table.from, table.to));
    }

    return Decoration.set(decorations);
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
