import type { StateEffect } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { CLASS_CELL_EDITOR } from '../../shared/tableDomClasses';
import { clearActiveCellEffect, getActiveCell } from '../../tableState/activeCellState';
import { clearCellSelectionEffect, getCellSelection } from '../../tableState/cellSelectionState';
import { CLASS_FLOATING_TOOLBAR, SELECTOR_WIDGET } from '../../tableWidget/domHelpers';
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
        target.closest(SELECTOR_WIDGET) ||
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
        ...(live.hasActiveCell ? [clearActiveCellEffect.of(null)] : []),
        ...(live.hasCellSelection ? [clearCellSelectionEffect.of(null)] : []),
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

/** Fallback when the pointer maps to no document position: clear state, leave the caret alone. */
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

/** The clicked document position, or null when coordinate mapping cannot supply a usable one. */
function resolveClickPosition(view: EditorView, event: MouseEvent | PointerEvent): number | null {
    const mapped = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
    if (isValidDocumentPosition(mapped, view.state.doc.length)) {
        return mapped;
    }

    logger.debug('Coordinate mapping returned no usable position; leaving the caret in place', {
        mapped,
    });
    return null;
}

function resolveOutsideTableState(view: EditorView, event: MouseEvent | PointerEvent): LiveTableState | null {
    // Keep editor open if interaction is inside the widget or nested editor.
    const target = getEventTargetElement(event);
    if (!target || isInsideTableUi(target)) {
        return null;
    }

    return resolveLiveTableState(view);
}

function handleOutsideContextMenu(view: EditorView, event: MouseEvent): void {
    const live = resolveOutsideTableState(view, event);
    if (!live) {
        return;
    }

    const clickPos = resolveClickPosition(view, event);
    if (clickPos === null) {
        clearTableStateInPlace(view, live);
        return;
    }

    moveCaretAndClearTableState(view, clickPos, live, { preserveContextMenu: true });
}

/** Closes table state after CodeMirror has established the outside mouse selection. */
export function handleOutsideMouseDown(view: EditorView, event: MouseEvent): void {
    if (!resolveOutsideTableState(view, event)) return;

    const clickPos = resolveClickPosition(view, event);
    const startState = view.state;
    // CodeMirror must read the press against the geometry the user clicked. Closing
    // a multiline cell here can shrink the table before its native mouse handler runs.
    queueMicrotask(() => {
        if (!view.dom.isConnected) return;
        const currentLive = resolveLiveTableState(view);
        if (!currentLive) return;

        // A document change remaps the active cell to a new object, so identity only
        // detects another handler switching cells while the document is unchanged.
        const docChanged = view.state.doc !== startState.doc;
        if (!docChanged && getActiveCell(view.state) !== getActiveCell(startState)) return;

        // A document change makes the mapped click position stale, but the press still closes the table.
        if (!docChanged && clickPos !== null && view.state.selection.eq(startState.selection)) {
            moveCaretAndClearTableState(view, clickPos, currentLive, { preserveContextMenu: false });
        } else {
            // Preserve native shift/double clicks and the anchor established for dragging.
            clearTableStateInPlace(view, currentLive);
        }
    });
}

export const closeOnOutsideMouseDown = EditorView.domEventHandlers({
    mousedown: (event, view) => {
        handleOutsideMouseDown(view, event);
        // Never consume the press: CodeMirror's own mousedown handling starts drag selection.
        return false;
    },
});

export const outsideInteractionCapturePlugin = ViewPlugin.fromClass(
    class {
        private readonly onContextMenu: (event: MouseEvent) => void;

        constructor(private readonly view: EditorView) {
            this.onContextMenu = (event) => {
                handleOutsideContextMenu(this.view, event);
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
