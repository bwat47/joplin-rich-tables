import type { EditorState } from '@codemirror/state';
import type { SerializedTable } from '../../tableModel/MarkdownTable';
import { parseSingleTableBlock } from '../../tableModel/singleTableBlock';
import { buildIsolatedRootTableInsertRewrite, buildRootTableInsertRewrite } from './rootTableInsertRewrite';

export interface RootTablePasteRewrite {
    changes: {
        from: number;
        to: number;
        insert: string;
    };
    /**
     * Absolute table start in the post-change document.
     */
    tableFrom: number;
    serialized: SerializedTable;
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
    const serialized = table.serializeWithOffsets();
    const rewrite =
        buildIsolatedRootTableInsertRewrite(state, from, to, serialized.text) ??
        buildRootTableInsertRewrite(state, from, to, serialized.text);

    return {
        ...rewrite,
        serialized,
    };
}
