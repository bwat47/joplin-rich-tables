import type { EditorSelection } from '@codemirror/state';
import type { LocalSelection } from '../editorBridge/cellTextCodec';
import type { InitialCursorPos } from '../shared/cursorPlacement';
import { clamp } from '../shared/numberUtils';

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
 * `lastLineStart` splits on the last newline, so a single-line cell collapses to
 * the start and a trailing newline leaves the caret on the empty final line.
 *
 * Exact offsets are clamped rather than trusted: they are measured against the cell
 * text as it stood when the placement was decided, and an entry that repairs the
 * table into canonical form can rewrite that cell's padding in the same
 * transaction.
 */
export function resolveInitialLocalSelection(
    mirroredSelection: LocalSelection,
    localText: string,
    initialCursorPos?: InitialCursorPos
): LocalSelection {
    if (typeof initialCursorPos === 'object') {
        const { anchor, head } = initialCursorPos;
        return { anchor: clamp(anchor, 0, localText.length), head: clamp(head, 0, localText.length) };
    }

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
