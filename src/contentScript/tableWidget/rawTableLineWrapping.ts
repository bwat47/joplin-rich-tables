import { Range, StateField, type EditorState } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView } from '@codemirror/view';
import { isEffectiveRawMode } from '../tableState/sourceMode';
import { findTableRanges } from '../tableRuntime/tableResolution';

export const CLASS_RAW_TABLE_SOURCE_NOWRAP = 'cm-rt-table-source-nowrap';

const rawTableLineDecoration = Decoration.line({
    class: CLASS_RAW_TABLE_SOURCE_NOWRAP,
});

export function buildRawTableLineWrappingDecorations(state: EditorState): DecorationSet {
    const decorations: Range<Decoration>[] = [];
    const tables = findTableRanges(state);

    for (const table of tables) {
        let line = state.doc.lineAt(table.from);

        while (line.from < table.to) {
            decorations.push(rawTableLineDecoration.range(line.from));

            if (line.to >= table.to || line.number >= state.doc.lines) {
                break;
            }
            line = state.doc.line(line.number + 1);
        }
    }

    return Decoration.set(decorations);
}

export const rawTableLineWrappingField = StateField.define<DecorationSet>({
    create(state) {
        return isEffectiveRawMode(state) ? buildRawTableLineWrappingDecorations(state) : Decoration.none;
    },
    update(decorations, transaction) {
        const wasRawMode = isEffectiveRawMode(transaction.startState);
        const isRawMode = isEffectiveRawMode(transaction.state);

        if (!isRawMode) {
            return Decoration.none;
        }

        if (!wasRawMode || transaction.docChanged) {
            return buildRawTableLineWrappingDecorations(transaction.state);
        }

        return decorations;
    },
    provide: (field) => EditorView.decorations.from(field),
});

export const rawTableLineWrappingTheme = EditorView.baseTheme({
    [`.cm-line.${CLASS_RAW_TABLE_SOURCE_NOWRAP}`]: {
        whiteSpace: 'pre !important',
        overflowWrap: 'normal',
        wordBreak: 'normal',
    },
});
