import type { LocalSelection } from '../editorBridge/cellTextCodec';

/**
 * Where the caret should land when a cell is opened programmatically.
 *
 * The value travels from the code that decides the placement (keyboard
 * navigation, structural mutations, click-to-caret placement) through an
 * open-cell request to the nested editor, which applies it in
 * `resolveInitialLocalSelection`. Each hop is a separate module, so the
 * vocabulary is defined here once instead of being re-declared at every boundary.
 *
 * - `start` / `end`: collapse to the corresponding edge of the cell text.
 * - `lastLineStart`: collapse to the start of the final line, so moving up into
 *   a multi-line cell lands on the line nearest the cell the caret came from.
 * - a {@link LocalSelection}: exact offsets in the cell text, preserving direction and
 *   collapsing to a caret when the two are equal. Carried by placements derived from
 *   something outside the document - a click or drag on rendered Markdown, whose offsets come
 *   from aligning what was drawn against the source. They are clamped when applied, because
 *   the entry that carries them may rewrite the cell's padding in the same transaction.
 *
 * Omitting the value mirrors the main editor's own selection into the cell.
 */
export type InitialCursorPos = 'start' | 'end' | 'lastLineStart' | LocalSelection;

/** The placement that opens a cell with its caret at `offset` in the cell text. */
export function cellTextCaret(offset: number): LocalSelection {
    return { anchor: offset, head: offset };
}
