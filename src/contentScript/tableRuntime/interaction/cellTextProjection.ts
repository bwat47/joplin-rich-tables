import type { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { toLocalSelection } from '../../editorBridge/cellTextCodec';
import type { ResolvedActiveCell } from '../activeCell/resolvedActiveCell';

/** Visible source characters and their offsets in the nested editor's decoded text. */
export interface CellTextProjection {
    text: string;
    toLocal: Int32Array;
}

const HIDDEN_NODES = new Set([
    'Image',
    'HTMLTag',
    'Comment',
    'ProcessingInstruction',
    'EmphasisMark',
    'StrikethroughMark',
    'CodeMark',
    'LinkMark',
    // Transformed entities are handled by alignment, never by matching their spelling.
    'Entity',
]);

/**
 * Projects inline syntax from the main editor into visible text. Link destinations and
 * titles are excluded as a whole, including their whitespace. Autolink URLs remain visible.
 * Unknown renderer extensions are left to the constrained alignment fallback.
 */
export function projectCellText(
    state: EditorState,
    cell: ResolvedActiveCell,
    rootText: string,
    localText: string
): CellTextProjection {
    const hidden = new Uint8Array(localText.length);
    const exclude = (from: number, to: number): void => {
        const range = toLocalSelection(
            {
                anchor: Math.max(from, cell.editableFrom) - cell.editableFrom,
                head: Math.min(to, cell.editableTo) - cell.editableFrom,
            },
            rootText
        );
        hidden.fill(1, range.anchor, range.head);
    };

    syntaxTree(state).iterate({
        from: cell.editableFrom,
        to: cell.editableTo,
        enter(node) {
            if (node.name === 'Link') {
                // The first direct closing bracket ends the label, even with nested emphasis.
                for (let child = node.node.firstChild; child; child = child.nextSibling) {
                    if (child.name === 'LinkMark' && state.doc.sliceString(child.from, child.to) === ']') {
                        exclude(child.from, node.to);
                        break;
                    }
                }
            }
            if (node.name === 'Escape') {
                // Pipe escapes are already removed by the root-to-local codec.
                if (state.doc.sliceString(node.from, node.to) !== '\\|') {
                    exclude(node.from, node.from + 1);
                }
                return false;
            }
            if (HIDDEN_NODES.has(node.name)) {
                // Stored line breaks become real newlines in the nested editor.
                if (node.name !== 'HTMLTag' || state.doc.sliceString(node.from, node.to) !== '<br>') {
                    exclude(node.from, node.to);
                }
                return false;
            }
        },
    });

    let text = '';
    const offsets: number[] = [];
    for (let i = 0; i < localText.length; i++) {
        if (!hidden[i]) {
            text += localText[i];
            offsets.push(i);
        }
    }
    return { text, toLocal: Int32Array.from(offsets) };
}
