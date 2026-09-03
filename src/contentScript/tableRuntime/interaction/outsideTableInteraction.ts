import type { StateEffect } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { CLASS_CELL_EDITOR } from '../../shared/tableDomClasses';
import { clearActiveCellEffect, getActiveCell } from '../../tableState/activeCellState';
import { clearCellSelectionEffect, getCellSelection } from '../../tableState/cellSelectionState';
import { CLASS_FLOATING_TOOLBAR, getWidgetSelector } from '../../tableWidget/domHelpers';
import { isNestedEditorOpen } from '../../nestedEditor/nestedEditorController';
import { logger } from '../../../logger';

function getEventTargetElement(event: MouseEvent | PointerEvent): Element | null {
    const target = event.target;
    if (!target) return null;
    if (target instanceof Element) return target;
    if (target instanceof Node) return target.parentElement;
    return null;
}

/** True when the event landed on the table widget, a cell editor, or the floating toolbar. */
function isInsideTableUi(target: Element): boolean {
    return Boolean(
        target.closest(getWidgetSelector()) ||
        target.closest(`.${CLASS_CELL_EDITOR}`) ||
        target.closest(`.${CLASS_FLOATING_TOOLBAR}`)
    );
}

interface OutsideInteractionOptions {
    preserveContextMenu: boolean;
}

/** Whichever pieces of table state an outside interaction would tear down. */
interface LiveTableState {
    hasActiveCell: boolean;
    hasNestedEditor: boolean;
    hasCellSelection: boolean;
}

/** Live table state, or null when nothing is open and the interaction can be ignored. */
function resolveLiveTableState(view: EditorView): LiveTableState | null {
    const live: LiveTableState = {
        hasActiveCell: Boolean(getActiveCell(view.state)),
        hasNestedEditor: isNestedEditorOpen(view),
        hasCellSelection: Boolean(getCellSelection(view.state)),
    };
    if (!live.hasActiveCell && !live.hasNestedEditor && !live.hasCellSelection) {
        return null;
    }
    return live;
}

/** Effects that tear down whichever table selection state is currently live. */
function buildClearEffects(live: LiveTableState): StateEffect<unknown>[] {
    return [
        ...(live.hasActiveCell ? [clearActiveCellEffect.of(undefined)] : []),
        ...(live.hasCellSelection ? [clearCellSelectionEffect.of(undefined)] : []),
    ];
}

/** Moves the caret to the clicked position and clears table state around it. */
function moveCaretAndClearTableState(
    view: EditorView,
    clickPos: number,
    live: LiveTableState,
    options: OutsideInteractionOptions
): void {
    // On right-click context menus, avoid forcing focus/scroll so the native/Joplin
    // menu opens against the expected pointer target without viewport jumps.
    view.dispatch({
        selection: { anchor: clickPos },
        effects: buildClearEffects(live),
        scrollIntoView: !options.preserveContextMenu,
    });
    // A right-click only claims focus when the nested editor we just destroyed held it;
    // otherwise focus stays put so the menu anchors to whatever was clicked.
    if (!options.preserveContextMenu || live.hasNestedEditor) {
        view.focus();
    }
}

/** Last resort when no mapping places the pointer: clear state, leave the caret alone. */
function clearTableStateInPlace(view: EditorView, live: LiveTableState): void {
    if (!live.hasActiveCell && !live.hasCellSelection) {
        return;
    }
    view.dispatch({ effects: buildClearEffects(live) });
}

/**
 * Validates a position returned from coordinate mapping before it reaches EditorSelection.
 *
 * `posAtCoords` is typed as always returning a number for the imprecise overload, but it
 * returns `undefined` in practice when another plugin's decorations defeat its DOM scan.
 * EditorSelection accepts such a value: its own check only rejects a range past the end of
 * the document, so `undefined` reaches the state fields and throws from `doc.lineAt` in
 * whichever one reads the selection anchor.
 */
function isValidDocumentPosition(position: unknown, docLength: number): position is number {
    if (typeof position !== 'number') {
        return false;
    }
    return Number.isInteger(position) && position >= 0 && position <= docLength;
}

/**
 * The clicked document position, or null when neither mapping can supply a usable one.
 *
 * The fallback reads the height map instead of the DOM, so it survives the decorations that
 * defeat `posAtCoords` and yields a document position by construction. It only resolves the
 * clicked line rather than the column, which is enough to move the caret out of the table.
 */
function resolveClickPosition(view: EditorView, event: MouseEvent | PointerEvent): number | null {
    const docLength = view.state.doc.length;

    const mapped = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
    if (isValidDocumentPosition(mapped, docLength)) {
        return mapped;
    }

    logger.debug('Coordinate mapping returned no usable position; estimating from height map', {
        mapped,
    });
    const estimated = view.lineBlockAtHeight(event.clientY - view.documentTop).from;
    return isValidDocumentPosition(estimated, docLength) ? estimated : null;
}

function handleOutsideTableInteraction(
    view: EditorView,
    event: MouseEvent | PointerEvent,
    options: OutsideInteractionOptions
): boolean {
    // Keep editor open if interaction is inside the widget or nested editor.
    const target = getEventTargetElement(event);
    if (!target || isInsideTableUi(target)) {
        return false;
    }

    const live = resolveLiveTableState(view);
    if (!live) {
        return false;
    }

    const clickPos = resolveClickPosition(view, event);
    if (clickPos === null) {
        clearTableStateInPlace(view, live);
        return false;
    }

    moveCaretAndClearTableState(view, clickPos, live, options);
    // For mousedown, consume once we have positioned the cursor: CodeMirror's own handler
    // would otherwise repeat the coordinate mapping that just failed, and dispatch its
    // unusable result. For contextmenu, never consume so native/Joplin menus can open.
    return !options.preserveContextMenu;
}

/** Handles an outside-table mousedown and closes any live table interaction state. */
export function handleOutsideMouseDown(view: EditorView, event: MouseEvent): boolean {
    return handleOutsideTableInteraction(view, event, { preserveContextMenu: false });
}

export const closeOnOutsideMouseDown = EditorView.domEventHandlers({
    mousedown: (event, view) => handleOutsideMouseDown(view, event),
});

export const outsideInteractionCapturePlugin = ViewPlugin.fromClass(
    class {
        private readonly onContextMenu: (event: MouseEvent) => void;

        constructor(private readonly view: EditorView) {
            this.onContextMenu = (event) => {
                // Return value is intentionally ignored for document-level contextmenu.
                // We only need side effects (close/clear), not event consumption control.
                handleOutsideTableInteraction(this.view, event, { preserveContextMenu: true });
            };

            const doc = this.view.dom.ownerDocument;
            // Register on the document in capture phase so outside right-click interactions
            // are seen even when Joplin/Electron context menu handlers intercept later in bubbling.
            doc.addEventListener('contextmenu', this.onContextMenu, true);
        }

        destroy(): void {
            const doc = this.view.dom.ownerDocument;
            doc.removeEventListener('contextmenu', this.onContextMenu, true);
        }
    }
);
