import { EditorView } from '@codemirror/view';
import { activeCellField, getActiveCell } from '../tableState/activeCellState';
import { CLASS_CELL_EDITOR } from '../shared/tableDomClasses';

// Set data-rt-nested-active on Joplin's root .cm-editor when a cell is being edited.
// This attribute lets the suppression theme below scope its selectors from the root.
export const rootEditorActiveCellAttribute = EditorView.editorAttributes.compute(
    [activeCellField],
    (state): Record<string, string> => (getActiveCell(state) ? { 'data-rt-nested-active': '' } : {})
);

// Suppress the browser's native ::selection highlight inside the nested cell editor.
// Registered on the root editor so `&` resolves to Joplin's .cm-editor, giving the
// selector 1 attribute + 3 classes of specificity — enough to beat Joplin's own
// `&.cm-focused ::selection !important` rule (2 classes) regardless of source order.
export const rootEditorSelectionSuppression = EditorView.baseTheme({
    [`&[data-rt-nested-active] .${CLASS_CELL_EDITOR} .cm-content::selection`]: {
        'background-color': 'transparent !important',
        color: 'inherit !important',
    },
    [`&[data-rt-nested-active] .${CLASS_CELL_EDITOR} .cm-content *::selection`]: {
        'background-color': 'transparent !important',
        color: 'inherit !important',
    },
});
