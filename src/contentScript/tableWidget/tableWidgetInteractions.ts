import type { EditorView } from '@codemirror/view';
import { setActiveCellEffect, type ActiveCellSection } from './activeCellState';
import { openNestedCellEditor } from '../nestedEditor/nestedCellEditor';
import { openLink } from '../services/markdownRenderer';
import { resolveCellDocRange, resolveTableFromEventTarget } from './tablePositioning';
import { computeMarkdownTableCellRanges } from '../tableModel/markdownTableCellRanges';
import {
    DATA_COL,
    DATA_ROW,
    DATA_SECTION,
    CLASS_CELL_EDITOR,
    SECTION_HEADER,
    getCellSelector,
    getWidgetSelector,
} from './domHelpers';
import { makeTableId } from '../tableModel/types';

function getLinkHrefFromTarget(target: HTMLElement): string | null {
    const link = target.closest('a');
    if (!link) {
        return null;
    }

    // Check for Joplin internal link data attributes first
    // renderMarkup converts :/id links to href="#" with data attributes
    const resourceId = link.getAttribute('data-resource-id');
    const noteId = link.getAttribute('data-note-id') || link.getAttribute('data-item-id');

    if (resourceId) {
        return `:/${resourceId}`;
    }

    if (noteId) {
        return `:/${noteId}`;
    }

    const href = link.getAttribute('href');
    if (!href || href === '#' || href === '') {
        return null;
    }

    return href;
}

/**
 * Handle internal anchor links by scrolling to the footnote definition.
 * Footnote anchors can be #fn1, #fn-1, #fnref1, #fnref-1 depending on markdown-it config.
 */
import { slugify } from '../shared/cellContentUtils';

export function scrollToAnchor(view: EditorView, anchor: string): void {
    // 1. Try Footnote Extraction
    // Defines: #fn1, #fn-1, #fnref1, #fnref-1 (with or without hyphen)
    const fnMatch = anchor.match(/^#fn-?(.+)$/) || anchor.match(/^#fnref-?(.+)$/);
    if (fnMatch) {
        const label = fnMatch[1];
        // Search for the footnote definition [^label]: in the document
        // We use a regex that is robust to spacing
        const pattern = new RegExp(`^\\s*\\[\\^${escapeRegex(label)}\\]:`, 'i');
        findAndScrollToPattern(view, pattern);
        return;
    }

    // 2. Try Heading Extraction
    const activeSlug = anchor.replace(/^#/, '');

    // Search specifically for headings (lines starting with #)
    const doc = view.state.doc;
    for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);
        const text = line.text;

        // Fast check: must start with #
        if (!text.startsWith('#')) continue;

        // Verify it is a heading: 1-6 #s followed by space
        const headingMatch = text.match(/^(#{1,6})\s+(.*)/);
        if (headingMatch) {
            const headingContent = headingMatch[2].trim();
            // Slugify matches Joplin's ID generation
            if (slugify(headingContent) === activeSlug) {
                view.dispatch({
                    selection: { anchor: line.from },
                    scrollIntoView: true,
                });
                view.focus();
                return;
            }
        }
    }
}

function findAndScrollToPattern(view: EditorView, pattern: RegExp): void {
    const doc = view.state.doc;
    for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);
        if (pattern.test(line.text)) {
            view.dispatch({
                selection: { anchor: line.from },
                scrollIntoView: true,
            });
            view.focus();
            return;
        }
    }
}

/** Escape special regex characters in a string */
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

    // Let the nested editor handle its own events.
    if (target.closest(`.${CLASS_CELL_EDITOR}`)) {
        return false;
    }

    const isLink = Boolean(target.closest('a'));

    // Handle Click events: strict link opening
    if (event.type === 'click') {
        const mouseEvent = event as MouseEvent;
        // Only handle left clicks
        if (mouseEvent.button !== 0) {
            return false;
        }

        if (isLink) {
            const href = getLinkHrefFromTarget(target);
            if (href) {
                event.preventDefault();
                event.stopPropagation();

                // Handle internal anchor links (e.g., footnotes #fn-1, #fnref-1)
                // Joplin's openItem doesn't support these, so we scroll manually
                if (href.startsWith('#')) {
                    scrollToAnchor(view, href);
                    return true;
                }

                openLink(href);
                return true;
            }
        }
        return false;
    }

    // Handle Mousedown events: cell activation
    if (event.type === 'mousedown') {
        // If clicking a link with LEFT click, we want to PREVENT cell handling so the Click event can fire cleanly
        // and open the link.
        // If we processed cell activation here, it might swallow the event or change focus
        // in a way that prevents the click.
        // However, allow RIGHT click (button 2) to fall through to cell activation so we can open the editor
        // and see the context menu.
        const mouseEvent = event as MouseEvent;
        if (isLink && mouseEvent.button === 0) {
            return true; // Claim the event to prevent CodeMirror default selection, but don't activate cell
        }

        // Cell activation logic
        const cell = target.closest('td, th') as HTMLElement | null;
        if (!cell) {
            return false;
        }

        const section = (cell.dataset[DATA_SECTION] as ActiveCellSection | undefined) ?? null;
        const row = Number(cell.dataset[DATA_ROW]);
        const col = Number(cell.dataset[DATA_COL]);

        if (!section || Number.isNaN(row) || Number.isNaN(col)) {
            return false;
        }

        const table = resolveTableFromEventTarget(view, cell);
        if (!table) {
            return false;
        }

        const cellRanges = computeMarkdownTableCellRanges(table.text);
        if (!cellRanges) {
            return false;
        }

        const resolvedRange = resolveCellDocRange({
            tableFrom: table.from,
            ranges: cellRanges,
            coords: { section, row, col },
        });
        if (!resolvedRange) {
            return false;
        }

        const { cellFrom, cellTo } = resolvedRange;

        event.preventDefault();
        event.stopPropagation();

        view.dispatch({
            selection: { anchor: cellFrom },
            effects: setActiveCellEffect.of({
                tableFrom: table.from,
                tableTo: table.to,
                cellFrom,
                cellTo,
                section,
                row: section === SECTION_HEADER ? 0 : row,
                col,
            }),
        });

        // After dispatch, the decoration rebuild may have destroyed and recreated widget DOM.
        // Re-query for the fresh cell element using data attributes to avoid stale references.
        const freshWidget = view.dom.querySelector(getWidgetSelector(makeTableId(table.from))) as HTMLElement | null;

        if (freshWidget) {
            const freshCell = freshWidget.querySelector(getCellSelector({ section, row, col })) as HTMLElement | null;

            if (freshCell) {
                openNestedCellEditor({
                    mainView: view,
                    cellElement: freshCell,
                    cellFrom,
                    cellTo,
                });
            }
        }

        return true;
    }

    return false;
}
