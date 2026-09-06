import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { cellSelectionField, getCellSelection } from '../tableState/cellSelectionState';
import { getPendingOpenCellRequest, openCellRequestField } from '../tableRuntime/openCellRequest';

/** Marks the editor root while the main editor's caret should not be painted. */
const ATTR_CARET_SUPPRESSED = 'data-rt-caret-suppressed';

/**
 * Hides the main editor's caret while the table owns interaction, for either of two reasons.
 *
 * A **cell selection** parks the real caret at the focus cell's document position so clipboard
 * and shortcut handling keep working. `TableWidget.coordsAt` maps that position onto the cell's
 * rectangle, so the caret paints inside the rendered table — a blinking insertion point between
 * cells, in a table where typing is not what the selection is for. The highlight carries the
 * state instead.
 *
 * A **cell being opened** moves the main selection to the cell's source offset, which is inside
 * the table's block widget, and the nested editor mounts an animation frame later. The main
 * editor keeps focus across that gap, so without this it paints a caret at the widget boundary
 * — a stripe on the cell divider, right where the click landed, a frame before the real caret
 * appears in the cell.
 *
 * `caret-color` covers the browser's native caret; `.cm-cursorLayer` covers the one
 * `drawSelection` paints when the host editor enables it.
 */
export const mainCaretSuppression: Extension = [
    EditorView.editorAttributes.compute([cellSelectionField, openCellRequestField], (state): Record<string, string> =>
        getCellSelection(state) || getPendingOpenCellRequest(state) ? { [ATTR_CARET_SUPPRESSED]: '' } : {}
    ),
    EditorView.baseTheme({
        [`&[${ATTR_CARET_SUPPRESSED}] .cm-content`]: {
            caretColor: 'transparent',
        },
        [`&[${ATTR_CARET_SUPPRESSED}] .cm-cursorLayer`]: {
            display: 'none',
        },
    }),
];
