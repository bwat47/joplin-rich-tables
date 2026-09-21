/**
 * Geometry shared by the two boxes that can own a table cell's interior: the rendered content
 * wrapper and the nested editor's `.cm-content`.
 *
 * The inset between a cell's gridline and its text belongs to those boxes rather than to the
 * `<td>`. Padding on the `<td>` sits outside both of them, so a press in it reaches neither the
 * rendered content's hit test nor CodeMirror's `posAtCoords`, leaving a band around every cell
 * that starts no text selection. Both boxes declare the same inset, so activating a cell leaves
 * its text where the reader saw it.
 */

/**
 * Width of the gridline between cells.
 *
 * `border-collapse` makes each one shared, so this is the whole line, not a half of one --
 * `selectionTint.ts` redraws a gridline at exactly this width.
 */
export const CELL_BORDER_WIDTH = '1px';

/** Inset above and below a cell's text. */
const CELL_PADDING_BLOCK = '8px';

/** Inset to either side of a cell's text. */
const CELL_PADDING_INLINE = '12px';

/** The inset as the content boxes declare it. */
export const CELL_PADDING = `${CELL_PADDING_BLOCK} ${CELL_PADDING_INLINE}`;

/** Narrowest a column's text is squeezed before the cell stops shrinking. */
const CELL_MIN_TEXT_WIDTH = '75px';

/**
 * Narrowest a cell may be. The inset now sits inside the cell's box rather than on it, so it is
 * added back here to keep columns as wide as they were when the `<td>` carried the padding.
 */
export const CELL_MIN_WIDTH = `calc(${CELL_MIN_TEXT_WIDTH} + 2 * ${CELL_PADDING_INLINE})`;
