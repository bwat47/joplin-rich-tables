/**
 * Where the caret should land when a cell is opened programmatically.
 *
 * The value travels from the code that decides the placement (keyboard
 * navigation, structural mutations) through an open-cell request to the nested
 * editor, which applies it in `resolveInitialLocalSelection`. Each hop is a
 * separate module, so the vocabulary is defined here once instead of being
 * re-declared at every boundary.
 *
 * - `start` / `end`: collapse to the corresponding edge of the cell text.
 * - `lastLineStart`: collapse to the start of the final line, so moving up into
 *   a multi-line cell lands on the line nearest the cell the caret came from.
 *
 * Omitting the value mirrors the main editor's own selection into the cell.
 */
export type InitialCursorPos = 'start' | 'end' | 'lastLineStart';
