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
 * - {@link CellTextOffset}: collapse to a specific offset in the cell text.
 * - {@link CellTextSelection}: select a range in the cell text, preserving direction.
 *
 * Omitting the value mirrors the main editor's own selection into the cell.
 */
export type InitialCursorPos = 'start' | 'end' | 'lastLineStart' | CellTextOffset | CellTextSelection;

/**
 * An exact caret offset in a cell's own text.
 *
 * Produced by placements derived from something outside the document - a click on rendered
 * Markdown, whose offset comes from aligning what was drawn against the source. The offset
 * is clamped when applied, because the entry that carries it may rewrite the cell's padding
 * in the same transaction.
 */
export interface CellTextOffset {
    localOffset: number;
}

/** Distinguishes an exact offset from the named edges. */
export function isCellTextOffset(value: InitialCursorPos): value is CellTextOffset {
    return typeof value === 'object' && 'localOffset' in value;
}

/** An initial range in decoded cell text, preserving selection direction. */
export interface CellTextSelection {
    localSelection: LocalSelection;
}
