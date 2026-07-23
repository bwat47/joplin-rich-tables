import { EditorState, RangeSetBuilder, StateField } from '@codemirror/state';
import { syntaxTreeAvailable } from '@codemirror/language';
import { Decoration, DecorationSet, EditorView } from '@codemirror/view';
import { logger } from '../../logger';
import { hashTableText } from '../shared/hashUtils';
import { buildTableContext } from '../tableModel/tableContext';
import { findTableRanges } from '../tableRuntime/tableResolution';
import { TableWidget } from './TableWidget';
import { decideTableDecorationUpdate } from './tableDecorationPolicy';

interface TableDecorationState {
    decorations: DecorationSet;
    /**
     * True when the last build ran before the document was fully parsed
     * (ensureSyntaxTree timed out), so tables may be missing. The background
     * parser dispatches transactions as it progresses; once the full tree is
     * available, the field rebuilds instead of keeping the incomplete set.
     */
    treeIncomplete: boolean;
}

/**
 * Build decorations for all tables in the document.
 * Tables are always rendered as widgets - editing happens via nested cell editors.
 */
function buildTableDecorations(state: EditorState): TableDecorationState {
    const tables = findTableRanges(state);
    if (!tables) {
        logger.warn('Syntax tree unavailable within timeout; table rendering deferred until parsing completes');
        return { decorations: Decoration.none, treeIncomplete: true };
    }

    const decorations = new RangeSetBuilder<Decoration>();
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

    return { decorations: decorations.finish(), treeIncomplete: false };
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
                return { decorations: Decoration.none, treeIncomplete: false };
            case 'keepDecorations':
                if (value.treeIncomplete && syntaxTreeAvailable(transaction.state)) {
                    return buildTableDecorations(transaction.state);
                }
                return value;
            case 'mapDecorations':
                return {
                    decorations: value.decorations.map(transaction.changes),
                    treeIncomplete: value.treeIncomplete,
                };
            case 'rebuildAllDecorations':
                return buildTableDecorations(transaction.state);
        }
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});
