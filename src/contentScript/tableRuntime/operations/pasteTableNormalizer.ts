import type { EditorState } from '@codemirror/state';
import { parseSingleTableBlock } from '../../tableModel/singleTableBlock';
import { buildIsolatedRootTableInsertRewrite, buildRootTableInsertRewrite } from './rootTableInsertRewrite';

export interface RootTablePasteRewrite {
    changes: {
        from: number;
        to: number;
        insert: string;
    };
    selectionAnchor: number;
    /**
     * Absolute table start in the post-change document.
     */
    tableFrom: number;
}

export function buildRootTablePasteRewrite(
    state: EditorState,
    from: number,
    to: number,
    clipboardText: string
): RootTablePasteRewrite | null {
    const table = parseSingleTableBlock(clipboardText);
    if (!table) {
        return null;
    }
    const canonicalTableText = table.serialize();
    const rewrite =
        buildIsolatedRootTableInsertRewrite(state, from, to, canonicalTableText) ??
        buildRootTableInsertRewrite(state, from, to, canonicalTableText);

    return {
        ...rewrite,
        selectionAnchor: rewrite.tableFrom,
    };
}
