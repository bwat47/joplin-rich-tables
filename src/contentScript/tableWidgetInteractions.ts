import type { EditorView } from '@codemirror/view';
import { setActiveCellEffect, type ActiveCellSection } from './activeCellState';
import { openNestedCellEditor } from './nestedCellEditor';
import { openLink } from './markdownRenderer';
import { getTableCellRanges, resolveCellDocRange, resolveTableFromEventTarget } from './tablePositioning';

function tryHandleLinkClick(target: HTMLElement): boolean {
    const link = target.closest('a');
    if (!link) {
        return false;
    }

    // Check for Joplin internal link data attributes first
    // renderMarkup converts :/id links to href="#" with data attributes
    const resourceId = link.getAttribute('data-resource-id');
    const noteId = link.getAttribute('data-note-id') || link.getAttribute('data-item-id');

    let href: string | null = null;
    if (resourceId) {
        href = `:/${resourceId}`;
    } else if (noteId) {
        href = `:/${noteId}`;
    } else {
        href = link.getAttribute('href');
        if (href === '#' || href === '') {
            href = null;
        }
    }

    if (href) {
        openLink(href);
    }

    return true;
}

export function handleTableWidgetMouseDown(view: EditorView, event: MouseEvent): boolean {
    const target = event.target as HTMLElement | null;
    if (!target) {
        return false;
    }

    // Only handle events inside table widgets.
    const widget = target.closest('.cm-table-widget');
    if (!widget) {
        return false;
    }

    // Let the nested editor handle its own events.
    if (target.closest('.cm-table-cell-editor')) {
        return false;
    }

    // Links: open, prevent selection.
    if (tryHandleLinkClick(target)) {
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    // Cell activation
    const cell = target.closest('td, th') as HTMLElement | null;
    if (!cell) {
        return false;
    }

    const section = (cell.dataset.section as ActiveCellSection | undefined) ?? null;
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);

    if (!section || Number.isNaN(row) || Number.isNaN(col)) {
        return false;
    }

    const table = resolveTableFromEventTarget(view, cell);
    if (!table) {
        return false;
    }

    const cellRanges = getTableCellRanges(table.text);
    if (!cellRanges) {
        return false;
    }

    const resolvedRange = resolveCellDocRange({
        tableFrom: table.from,
        ranges: cellRanges,
        section,
        row,
        col,
    });
    if (!resolvedRange) {
        return false;
    }

    const { cellFrom, cellTo } = resolvedRange;

    event.preventDefault();
    event.stopPropagation();

    view.dispatch({
        effects: setActiveCellEffect.of({
            tableFrom: table.from,
            tableTo: table.to,
            cellFrom,
            cellTo,
            section,
            row: section === 'header' ? 0 : row,
            col,
        }),
    });

    openNestedCellEditor({
        mainView: view,
        cellElement: cell,
        cellFrom,
        cellTo,
    });

    return true;
}
