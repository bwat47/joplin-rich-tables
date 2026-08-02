import type { EditorSelection } from '@codemirror/state';
import type { LocalSelection } from '../editorBridge/cellTextCodec';
import { clamp } from '../shared/numberUtils';

/** Where the caret should land when a nested editor is opened programmatically. */
export type InitialCursorPos = 'start' | 'end' | 'lastLineStart';

/** Shifts a cell-relative selection into main-document coordinates. */
export function toAbsoluteSelection(selection: LocalSelection, editableFrom: number): LocalSelection {
    return {
        anchor: editableFrom + selection.anchor,
        head: editableFrom + selection.head,
    };
}

/**
 * Projects the main editor's selection onto the editable cell range, clamping
 * endpoints that sit outside the cell so a selection spanning several cells
 * still yields an in-range cell-relative selection.
 */
export function toRelativeSelection(
    selection: EditorSelection,
    editableFrom: number,
    editableTo: number
): LocalSelection {
    const main = selection.main;
    return {
        anchor: clamp(main.anchor, editableFrom, editableTo) - editableFrom,
        head: clamp(main.head, editableFrom, editableTo) - editableFrom,
    };
}

export function areSelectionsEqual(a: LocalSelection, b: LocalSelection): boolean {
    return a.anchor === b.anchor && a.head === b.head;
}

/**
 * Resolves the caret placement for a freshly opened nested editor. Without an
 * explicit request the mirrored selection from the main editor wins; otherwise
 * the caret is collapsed to the requested edge of the cell text.
 *
 * `lastLineStart` targets the start of the final visual line, which is what
 * upward navigation into a multi-line cell expects.
 */
export function resolveInitialLocalSelection(
    mirroredSelection: LocalSelection,
    localText: string,
    initialCursorPos?: InitialCursorPos
): LocalSelection {
    switch (initialCursorPos) {
        case 'start':
            return { anchor: 0, head: 0 };
        case 'end':
            return { anchor: localText.length, head: localText.length };
        case 'lastLineStart': {
            const lastNewline = localText.lastIndexOf('\n');
            const pos = lastNewline === -1 ? 0 : lastNewline + 1;
            return { anchor: pos, head: pos };
        }
        default:
            return mirroredSelection;
    }
}
