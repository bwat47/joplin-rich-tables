import type { EditorView } from '@codemirror/view';
import { CLASS_CELL_ACTIVE, CLASS_CELL_EDITOR } from '../shared/tableDomClasses';
import { slugify } from '../shared/cellContentUtils';
import { parseFootnoteHref } from '../shared/footnoteAnchor';
import { clearActiveCellEffect, getActiveCell, isSameActiveCell } from '../tableState/activeCellState';
import { clearCellSelectionEffect, getCellSelection } from '../tableState/cellSelectionState';
import { setOrExtendCellSelectionToCoords } from '../tableRuntime/selection/cellSelectionController';
import { resolveTableContextFromEventTarget } from '../tableRuntime/tablePositioning';
import { linkOpenerFacet } from '../services/linkOpener';
import { MOUSE_BUTTON_LEFT } from '../shared/mouseButtons';
import { SELECTOR_CELL, getWidgetSelector, readCellCoords } from './domHelpers';
import { requestOpenCell } from '../tableRuntime/openCellRequest';
import { createResolvedActiveCell, type ResolvedActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import {
    beginMouseCellGesture,
    consumeMouseCellGestureMouseDown,
    observeActiveCellMouseGesture,
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

/** Click events: strict link opening. */
function handleWidgetClick(view: EditorView, event: MouseEvent, target: HTMLElement): boolean {
    // Only handle left clicks
    if (event.button !== MOUSE_BUTTON_LEFT) {
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
function handleWidgetMouseDown(view: EditorView, event: MouseEvent, target: HTMLElement): boolean {
    // A mouse pointerdown starts a provisional click-or-drag gesture. Some browsers still
    // emit the compatibility mousedown even though pointerdown was prevented; consume it so
    // the nested editor is not opened before the gesture resolves on pointerup.
    if (consumeMouseCellGestureMouseDown(view, event)) {
        return true;
    }

    // If clicking a link with LEFT click, we want to PREVENT cell handling so the Click event can fire cleanly
    // and open the link.
    // If we processed cell activation here, it might swallow the event or change focus
    // in a way that prevents the click.
    // However, allow RIGHT click (button 2) to fall through to cell activation so we can open the editor
    // and see the context menu.
    if (event.button === MOUSE_BUTTON_LEFT && target.closest(SELECTOR_LINK)) {
        if (getCellSelection(view.state)) {
            view.dispatch({ effects: clearCellSelectionEffect.of(undefined) });
        }
        return true; // Claim the event to prevent CodeMirror default selection, but don't activate cell
    }

    const cell = target.closest(SELECTOR_CELL) as HTMLElement | null;
    if (!cell) {
        // Consume the event to prevent CodeMirror's internal mousedown handler from
        // repositioning the cursor. Without this, clicking the widget's horizontal
        // scrollbar maps to a document position at or after the table, which clears
        // the active cell state and closes the nested editor.
        return true;
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

/** Starts a desktop-mouse gesture that becomes either cell activation or drag selection. */
function handleWidgetPointerDown(view: EditorView, event: PointerEvent, target: HTMLElement): boolean {
    if (
        event.pointerType !== 'mouse' ||
        event.button !== MOUSE_BUTTON_LEFT ||
        !event.isPrimary ||
        event.shiftKey ||
        target.closest(SELECTOR_LINK)
    ) {
        return false;
    }

    const pressed = resolveCellTarget(view, target);
    if (!pressed) {
        return false;
    }

    const { cell, resolvedCell } = pressed;
    if (
        cell.classList.contains(CLASS_CELL_ACTIVE) &&
        isSameActiveCell(getActiveCell(view.state), resolvedCell.activeCell)
    ) {
        return observeActiveCellMouseGesture(view, event, cell, resolvedCell, {
            consumeInitialEvents: true,
        });
    }

    return beginMouseCellGesture(view, event, cell, resolvedCell);
}

/** Passively observes a text-selection drag until it crosses into another table cell. */
function observeActiveEditorPointerDown(view: EditorView, event: PointerEvent, target: HTMLElement): void {
    const activeTarget = resolveCellTarget(view, target);
    if (!activeTarget || !isSameActiveCell(getActiveCell(view.state), activeTarget.resolvedCell.activeCell)) {
        return;
    }

    observeActiveCellMouseGesture(view, event, activeTarget.cell, activeTarget.resolvedCell, {
        consumeInitialEvents: false,
    });
}

/** Extend the cell selection (shift-click) or open the clicked cell. */
function activateCellFromMouseDown(view: EditorView, event: MouseEvent, cell: HTMLElement): boolean {
    const resolvedCell = resolveCell(view, cell);
    if (!resolvedCell) {
        return false;
    }

    event.preventDefault();
    event.stopPropagation();

    const hasSelection = Boolean(getCellSelection(view.state));
    if (event.shiftKey && setOrExtendCellSelectionToCoords(view, resolvedCell.activeCell, resolvedCell.tableFrom)) {
        return true;
    }

    requestOpenCell(view, {
        resolvedCell,
        clearCellSelection: hasSelection,
    });

    return true;
}

export function handleTableInteraction(view: EditorView, event: Event): boolean {
    const target = event.target as HTMLElement | null;
    if (!target) {
        return false;
    }

    // Only handle events inside table widgets.
    const widget = target.closest(getWidgetSelector());
    if (!widget) {
        return false;
    }

    // Let the nested editor handle its own events. Pointerdown is observed passively so
    // a text-selection drag can become a cell-selection drag after crossing a cell boundary.
    if (target.closest(`.${CLASS_CELL_EDITOR}`)) {
        if (event.type === 'pointerdown') {
            observeActiveEditorPointerDown(view, event as PointerEvent, target);
        }
        return false;
    }

    if (event.type === 'click') {
        return handleWidgetClick(view, event as MouseEvent, target);
    }

    if (event.type === 'mousedown') {
        return handleWidgetMouseDown(view, event as MouseEvent, target);
    }

    if (event.type === 'pointerdown') {
        return handleWidgetPointerDown(view, event as PointerEvent, target);
    }

    return false;
}
