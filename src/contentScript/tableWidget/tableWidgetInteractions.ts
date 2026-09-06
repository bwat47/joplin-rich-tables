import { ViewPlugin, type EditorView } from '@codemirror/view';
import { CLASS_CELL_ACTIVE, CLASS_CELL_EDITOR } from '../shared/tableDomClasses';
import { slugify } from '../shared/cellContentUtils';
import { parseFootnoteHref } from '../shared/footnoteAnchor';
import { clearActiveCellEffect, getActiveCell, isSameActiveCell } from '../tableState/activeCellState';
import { clearCellSelectionEffect, getCellSelection } from '../tableState/cellSelectionState';
import { setOrExtendCellSelectionToCoords } from '../tableRuntime/selection/cellSelectionController';
import { resolveTableContextFromEventTarget } from '../tableRuntime/tablePositioning';
import { linkOpenerFacet } from '../services/linkOpener';
import {
    applyPressDisposition,
    isPrimaryMouseButton,
    isPrimaryMousePointer,
    type PressDisposition,
} from '../shared/mouseEvents';
import { SELECTOR_CELL, getWidgetSelector, readCellCoords } from './domHelpers';
import { readRenderedCaretHit } from './cellCaretHit';
import { resolveClickCursorPos } from '../tableRuntime/interaction/clickCursorPlacement';
import { requestOpenCell } from '../tableRuntime/openCellRequest';
import { createResolvedActiveCell, type ResolvedActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import {
    beginMouseCellGesture,
    mouseCellGestureMouseDownDisposition,
} from '../tableRuntime/interaction/mouseCellDragSelection';

/** Matches fenced code block delimiters (``` or ~~~) */
const FENCED_CODE_REGEX = /^(`{3,}|~{3,})/;

/** Matches an ATX heading, capturing the hashes and the heading text: `## Some heading` */
const HEADING_REGEX = /^(#{1,6})\s+(.*)/;

const ANCHOR_HREF_PREFIX = '#';

const SELECTOR_LINK = 'a';

function getLinkHrefFromTarget(target: HTMLElement): string | null {
    const link = target.closest(SELECTOR_LINK);
    if (!link) {
        return null;
    }

    // Check for Joplin internal link data attributes first
    // renderMarkup converts :/id links to href="#" with data attributes
    const resourceId = link.dataset.resourceId;
    if (resourceId) {
        return `:/${resourceId}`;
    }

    const noteId = link.dataset.noteId || link.dataset.itemId;
    if (noteId) {
        return `:/${noteId}`;
    }

    const href = link.getAttribute('href');
    if (!href || href === ANCHOR_HREF_PREFIX || href === '') {
        return null;
    }

    return href;
}

/**
 * Position of the first document line matching `predicate`, skipping fenced code blocks.
 * Returns null when no line matches.
 */
function findLinePosition(view: EditorView, predicate: (line: string) => boolean): number | null {
    let lineStart = 0;
    let inFencedCode = false;

    for (const line of view.state.doc.iterLines()) {
        // Track fenced code blocks (``` or ~~~)
        if (FENCED_CODE_REGEX.test(line)) {
            inFencedCode = !inFencedCode;
        }

        if (!inFencedCode && predicate(line)) {
            return lineStart;
        }

        lineStart += line.length + 1; // +1 for newline
    }

    return null;
}

/** True when `line` is an ATX heading whose slugified text equals `slug`. */
function isHeadingWithSlug(line: string, slug: string): boolean {
    const headingMatch = line.match(HEADING_REGEX);
    return headingMatch !== null && slugify(headingMatch[2].trim()) === slug;
}

/**
 * Resolve an internal anchor link to a document position.
 * Footnote anchors are the ones this plugin renders for `[^label]` text; anything
 * else is treated as a heading slug.
 */
function resolveAnchorPosition(view: EditorView, anchor: string): number | null {
    const footnoteLabel = parseFootnoteHref(anchor);
    if (footnoteLabel !== null) {
        // Search for the footnote definition [^label]: in the document.
        // A footnote anchor never falls back to a heading lookup.
        const pattern = new RegExp(String.raw`^\s*\[\^${escapeRegex(footnoteLabel)}\]:`, 'i');
        return findLinePosition(view, (line) => pattern.test(line));
    }

    const activeSlug = anchor.replace(/^#/, '');
    return findLinePosition(view, (line) => isHeadingWithSlug(line, activeSlug));
}

/** Handle internal anchor links by scrolling to the footnote definition or heading. */
function scrollToAnchor(view: EditorView, anchor: string): void {
    const pos = resolveAnchorPosition(view, anchor);
    if (pos !== null) {
        scrollToPosition(view, pos);
    }
}

/** Scroll to a document position and focus the editor.
 * Clears active cell state to ensure table decorations rebuild with current content.
 */
function scrollToPosition(view: EditorView, pos: number): void {
    const hasActiveCell = getActiveCell(view.state) !== null;
    view.dispatch({
        selection: { anchor: pos },
        scrollIntoView: true,
        effects: hasActiveCell ? [clearActiveCellEffect.of(undefined)] : [],
    });
    view.focus();
}

/** Escape special regex characters in a string */
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Opens a link clicked inside a rendered cell.
 *
 * The only widget event still routed through `EditorView.domEventHandlers`: a click asks nothing
 * unusual of CodeMirror, so it keeps the ordering that registration gives it. Presses go through
 * {@link handleWidgetPress} instead.
 */
export function handleWidgetClick(view: EditorView, event: MouseEvent): boolean {
    const target = event.target as HTMLElement | null;
    if (!isPrimaryMouseButton(event) || !target?.closest(getWidgetSelector())) {
        return false;
    }

    if (target.closest(`.${CLASS_CELL_EDITOR}`)) {
        // The nested editor owns the rest of its own events.
        return false;
    }

    const href = getLinkHrefFromTarget(target);
    if (!href) {
        return false;
    }

    event.preventDefault();
    event.stopPropagation();

    // Handle internal anchor links (headings and footnotes, e.g. #fn-1)
    // Joplin's openItem doesn't support these, so we scroll manually
    if (href.startsWith(ANCHOR_HREF_PREFIX)) {
        scrollToAnchor(view, href);
        return true;
    }

    view.state.facet(linkOpenerFacet).open(href);
    return true;
}

/** Mousedown events: cell activation. */
function handleWidgetMouseDown(view: EditorView, event: MouseEvent, target: HTMLElement): PressDisposition {
    // If clicking a link with LEFT click, we want to PREVENT cell handling so the Click event can fire cleanly
    // and open the link.
    // If we processed cell activation here, it might swallow the event or change focus
    // in a way that prevents the click.
    // However, allow RIGHT click (button 2) to fall through to cell activation so we can open the editor
    // and see the context menu.
    if (isPrimaryMouseButton(event) && target.closest(SELECTOR_LINK)) {
        if (getCellSelection(view.state)) {
            view.dispatch({ effects: clearCellSelectionEffect.of(undefined) });
        }
        // Claim the event to prevent CodeMirror default selection, but don't activate cell.
        return 'consume';
    }

    const cell = target.closest(SELECTOR_CELL) as HTMLElement | null;
    if (!cell) {
        // Consume the event to prevent CodeMirror's internal mousedown handler from
        // repositioning the cursor. Without this, clicking the widget's horizontal
        // scrollbar maps to a document position at or after the table, which clears
        // the active cell state and closes the nested editor.
        return 'consume';
    }

    return activateCellFromMouseDown(view, event, cell);
}

interface ResolvedCellTarget {
    cell: HTMLElement;
    resolvedCell: ResolvedActiveCell;
}

/**
 * Resolves a widget cell element against the current document.
 *
 * Returns null for anything that is not one of `TableWidget`'s own cells, or whose
 * coordinates no longer map onto the parsed table.
 */
function resolveCell(view: EditorView, cell: HTMLElement): ResolvedActiveCell | null {
    const coords = readCellCoords(cell);
    const ctx = coords ? resolveTableContextFromEventTarget(view, cell) : null;

    return coords && ctx ? createResolvedActiveCell({ ctx, coords }) : null;
}

/** As {@link resolveCell}, starting from the element an event landed on. */
function resolveCellTarget(view: EditorView, target: HTMLElement): ResolvedCellTarget | null {
    const cell = target.closest(SELECTOR_CELL) as HTMLElement | null;
    const resolvedCell = cell ? resolveCell(view, cell) : null;

    return cell && resolvedCell ? { cell, resolvedCell } : null;
}

/**
 * Starts a desktop-mouse gesture that becomes either cell activation or drag selection.
 *
 * Declining leaves the press to the compatibility mousedown; see {@link handleWidgetPress}.
 */
function handleWidgetPointerDown(view: EditorView, event: PointerEvent, target: HTMLElement): PressDisposition {
    if (!isPrimaryMousePointer(event) || event.shiftKey || target.closest(SELECTOR_LINK)) {
        return 'native';
    }

    const pressed = resolveCellTarget(view, target);
    if (!pressed) {
        return 'native';
    }

    const { cell, resolvedCell } = pressed;
    // A press that reaches here on the active cell landed on its row-height padding rather than
    // on its editor, which is a separate origin reached through `observeActiveEditorPointerDown`.
    const pressedActiveCell =
        cell.classList.contains(CLASS_CELL_ACTIVE) &&
        isSameActiveCell(getActiveCell(view.state), resolvedCell.activeCell);

    return beginMouseCellGesture(
        view,
        event,
        cell,
        resolvedCell,
        pressedActiveCell ? 'activeEditorPadding' : 'renderedCell'
    );
}

/** Passively observes a text-selection drag until it crosses into another table cell. */
function observeActiveEditorPointerDown(view: EditorView, event: PointerEvent, target: HTMLElement): PressDisposition {
    const activeTarget = resolveCellTarget(view, target);
    if (!activeTarget || !isSameActiveCell(getActiveCell(view.state), activeTarget.resolvedCell.activeCell)) {
        return 'native';
    }

    return beginMouseCellGesture(view, event, activeTarget.cell, activeTarget.resolvedCell, 'activeEditorText');
}

/** Extend the cell selection (shift-click) or open the clicked cell. */
function activateCellFromMouseDown(view: EditorView, event: MouseEvent, cell: HTMLElement): PressDisposition {
    const resolvedCell = resolveCell(view, cell);
    if (!resolvedCell) {
        return 'native';
    }

    const hasSelection = Boolean(getCellSelection(view.state));
    if (event.shiftKey && setOrExtendCellSelectionToCoords(view, resolvedCell.activeCell, resolvedCell.tableFrom)) {
        return 'consume';
    }

    // Read the press against the rendered content before the open request replaces it, so
    // the caret lands where the reader pointed rather than at the start of the cell.
    const caretHit = readRenderedCaretHit(cell, event.clientX, event.clientY);

    requestOpenCell(view, {
        resolvedCell,
        clearCellSelection: hasSelection,
        initialCursorPos: resolveClickCursorPos(view.state, resolvedCell, caretHit),
    });

    return 'consume';
}

/**
 * Routes a press inside a table widget to the handler that owns it, and reports what that
 * handler wants done with the event.
 *
 * A cell press is split across two events by input type. Pointerdown claims only a plain
 * left-mouse press — the one that can become a drag — and leaves the rest native, which the
 * compatibility mousedown behind it then handles:
 *
 * - left mouse, no shift: pointerdown starts a click-or-drag gesture
 * - shift-click: mousedown extends the cell selection
 * - right click: mousedown opens the cell; preventing its pointerdown would suppress the
 *   context menu
 * - touch and pen: mousedown opens the cell; their pointerdown must stay native or the
 *   page cannot scroll
 * - links: click opens them, and mousedown only clears a stale selection
 *
 * Inside an open nested editor the press is only observed, never claimed, so shift is not
 * excluded there as it is above: shift-click extends the cell's own text selection, and the
 * gesture stays out of the way unless the pointer crosses into another cell.
 */
export function handleWidgetPress(view: EditorView, event: MouseEvent | PointerEvent): PressDisposition {
    // A pointerdown that started a gesture is followed by a compatibility mousedown in some
    // browsers. It belongs to the gesture, whatever it landed on, so it is answered before
    // anything about this press is resolved again.
    if (event.type === 'mousedown') {
        const gestureDisposition = mouseCellGestureMouseDownDisposition(view, event);
        if (gestureDisposition !== 'native') {
            return gestureDisposition;
        }
    }

    const target = event.target as HTMLElement | null;
    if (!target?.closest || !target.closest(getWidgetSelector())) {
        return 'native';
    }

    const insideNestedEditor = Boolean(target.closest(`.${CLASS_CELL_EDITOR}`));
    if (event.type === 'pointerdown') {
        return insideNestedEditor
            ? // Observed but never claimed, so the nested editor keeps its native text-selection
              // drag until the pointer crosses into another cell.
              observeActiveEditorPointerDown(view, event as PointerEvent, target)
            : handleWidgetPointerDown(view, event as PointerEvent, target);
    }

    // The nested editor owns the rest of its own events.
    return insideNestedEditor ? 'native' : handleWidgetMouseDown(view, event, target);
}

/**
 * The one place a press inside a table widget is dispatched from.
 *
 * Capture phase, because the disposition a press needs is not always one CodeMirror's own
 * dispatch can express: see {@link PressDisposition}. Running ahead of the outer editor's
 * handlers also means a press this router claims never reaches them at all.
 */
export const tableWidgetPressPlugin = ViewPlugin.define((view) => {
    const onPress = (event: MouseEvent | PointerEvent): void => {
        // Capture runs ahead of CodeMirror, which drops a default-prevented event in both
        // `runHandlers` and `eventBelongsToEditor`. `claim` also depends on the browser default
        // still running, so a cancelled press has no native selection for the release to map.
        if (event.defaultPrevented) {
            return;
        }

        applyPressDisposition(event, handleWidgetPress(view, event));
    };

    view.dom.addEventListener('pointerdown', onPress, true);
    view.dom.addEventListener('mousedown', onPress, true);
    return {
        destroy() {
            view.dom.removeEventListener('pointerdown', onPress, true);
            view.dom.removeEventListener('mousedown', onPress, true);
        },
    };
});
