import { WidgetType, EditorView } from '@codemirror/view';
import { ensureSyntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { getCached, renderMarkdownAsync, openLink } from './markdownRenderer';
import { getActiveCell, setActiveCellEffect, type ActiveCellSection } from './activeCellState';
import { openNestedCellEditor } from './nestedCellEditor';

function resolveCurrentTableAtDocPos(
    view: EditorView,
    pos: number
): { from: number; to: number; text: string; cellRanges: TableCellRanges | null } | null {
    const tree = ensureSyntaxTree(view.state, view.state.doc.length, 250);
    if (!tree) {
        return null;
    }

    let node: SyntaxNode | null = tree.resolve(pos, 1);
    while (node && node.name !== 'Table') {
        node = node.parent;
    }

    if (!node || node.name !== 'Table') {
        return null;
    }

    const from = node.from;
    const to = node.to;
    const text = view.state.doc.sliceString(from, to);
    const cellRanges = computeMarkdownTableCellRanges(text);

    return { from, to, text, cellRanges };
}

function resolveCurrentTableAtDomTarget(
    view: EditorView,
    domTarget: HTMLElement
): { from: number; to: number; text: string; cellRanges: TableCellRanges | null } | null {
    const pos = view.posAtDOM(domTarget, 0);
    return resolveCurrentTableAtDocPos(view, pos);
}

/**
 * Represents a parsed markdown table structure
 */
export interface TableData {
    headers: string[];
    alignments: ('left' | 'center' | 'right' | null)[];
    rows: string[][];
}

export interface CellRange {
    from: number;
    to: number;
}

interface TableCellRanges {
    headers: CellRange[];
    rows: CellRange[][];
}

/**
 * Widget that renders a markdown table as an interactive HTML table
 * Supports rendering markdown content inside cells
 */
export class TableWidget extends WidgetType {
    constructor(
        private tableData: TableData,
        private rawText: string,
        private tableFrom: number,
        private tableTo: number,
        private cellRanges: TableCellRanges | null
    ) {
        super();
    }

    eq(other: TableWidget): boolean {
        return this.rawText === other.rawText;
    }

    toDOM(view: EditorView): HTMLElement {
        const container = document.createElement('div');
        container.className = 'cm-table-widget';

        // Create edit button
        const editButton = document.createElement('button');
        editButton.className = 'cm-table-widget-edit-button';
        editButton.title = 'Edit table';
        editButton.innerHTML = '✏️';
        editButton.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            view.dispatch({
                selection: { anchor: this.tableFrom },
            });
            view.focus();
        });
        container.appendChild(editButton);

        // Handle clicks inside the widget (links + cell activation)
        container.addEventListener('mousedown', (e) => {
            const target = e.target as HTMLElement;

            // If interacting with the nested editor, let it handle events.
            if (target.closest('.cm-table-cell-editor')) {
                return;
            }

            // 1) Links
            const link = target.closest('a');
            if (link) {
                e.preventDefault();
                e.stopPropagation();

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
                    // Skip empty or placeholder hrefs
                    if (href === '#' || href === '') {
                        href = null;
                    }
                }

                if (href) {
                    openLink(href);
                }
                return;
            }

            // 2) Cell activation (Phase 2: map DOM cell -> source range)
            const cell = target.closest('td, th') as HTMLElement | null;
            if (!cell) {
                return;
            }

            const section = (cell.dataset.section as ActiveCellSection | undefined) ?? null;
            const row = Number(cell.dataset.row);
            const col = Number(cell.dataset.col);

            if (!section || Number.isNaN(row) || Number.isNaN(col)) {
                return;
            }

            // When a nested cell editor is open, the decoration set is mapped through changes
            // to keep the widget DOM stable. That means widget instance fields (tableFrom/tableTo/cellRanges)
            // can become stale after edits elsewhere. Resolve the current table range from the live syntax
            // tree at click time to always compute correct absolute positions.
            const resolvedTable =
                resolveCurrentTableAtDomTarget(view, cell) ??
                (() => {
                    // Fallback: in some cases `posAtDOM` inside replacement widgets can be unreliable.
                    // When a nested editor is open, activeCell positions are mapped through transactions
                    // and provide a stable doc position inside the current table.
                    const activeCell = getActiveCell(view.state);
                    if (!activeCell) {
                        return null;
                    }
                    return resolveCurrentTableAtDocPos(view, activeCell.cellFrom);
                })();
            const tableFrom = resolvedTable?.from ?? this.tableFrom;
            const tableTo = resolvedTable?.to ?? this.tableTo;
            const currentCellRanges = resolvedTable?.cellRanges ?? this.cellRanges;

            if (!currentCellRanges) {
                return;
            }

            const range = section === 'header' ? currentCellRanges.headers[col] : currentCellRanges.rows[row]?.[col];

            if (!range) {
                return;
            }

            e.preventDefault();
            e.stopPropagation();

            const cellFrom = tableFrom + range.from;
            const cellTo = tableFrom + range.to;

            view.dispatch({
                effects: setActiveCellEffect.of({
                    tableFrom,
                    tableTo,
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
        });

        const table = document.createElement('table');
        table.className = 'cm-table-widget-table';

        // Render header
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        for (let i = 0; i < this.tableData.headers.length; i++) {
            const th = document.createElement('th');
            th.dataset.section = 'header';
            th.dataset.row = '0';
            th.dataset.col = String(i);
            const content = this.tableData.headers[i].trim();
            this.renderCellContent(th, content);
            const align = this.tableData.alignments[i];
            if (align) {
                th.style.textAlign = align;
            }
            headerRow.appendChild(th);
        }
        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Render body
        const tbody = document.createElement('tbody');
        for (let r = 0; r < this.tableData.rows.length; r++) {
            const row = this.tableData.rows[r];
            const tr = document.createElement('tr');
            for (let i = 0; i < row.length; i++) {
                const td = document.createElement('td');
                td.dataset.section = 'body';
                td.dataset.row = String(r);
                td.dataset.col = String(i);
                const content = row[i].trim();
                this.renderCellContent(td, content);
                const align = this.tableData.alignments[i];
                if (align) {
                    td.style.textAlign = align;
                }
                tr.appendChild(td);
            }
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);

        container.appendChild(table);
        return container;
    }

    /**
     * Render cell content with markdown support
     * Uses cached HTML if available, otherwise shows text and updates async
     */
    private renderCellContent(cell: HTMLElement, markdown: string): void {
        // Check if we have cached rendered HTML
        const cached = getCached(markdown);
        if (cached !== undefined) {
            cell.innerHTML = cached;
            return;
        }

        // Show raw text initially
        cell.textContent = markdown;

        // Check if content likely contains markdown (optimization)
        if (this.containsMarkdown(markdown)) {
            // Request async rendering and update when ready
            renderMarkdownAsync(markdown, (html) => {
                // Only update if the cell is still in the DOM and content hasn't changed
                if (cell.isConnected && cell.textContent === markdown) {
                    cell.innerHTML = html;
                }
            });
        }
    }

    /**
     * Quick check if content likely contains markdown formatting
     * Avoids unnecessary render requests for plain text
     */
    private containsMarkdown(text: string): boolean {
        // Common markdown patterns
        return (
            text.includes('**') || // bold
            text.includes('__') || // bold
            text.includes('*') || // italic (single asterisk)
            text.includes('_') || // italic (single underscore)
            text.includes('`') || // code
            text.includes('[') || // links
            text.includes('~~') || // strikethrough
            text.includes('![') || // images
            text.includes('<') || // HTML tags
            text.includes('==') // Highlights
        );
    }

    ignoreEvent(): boolean {
        // We handle mouse events ourselves to reliably move cursor into table
        return true;
    }
}

/**
 * Parse alignment from separator row cell
 * Examples: :--- (left), :---: (center), ---: (right), --- (none)
 */
function parseAlignment(cell: string): 'left' | 'center' | 'right' | null {
    const trimmed = cell.trim();
    const left = trimmed.startsWith(':');
    const right = trimmed.endsWith(':');

    if (left && right) return 'center';
    if (left) return 'left';
    if (right) return 'right';
    return null;
}

/**
 * Parse a row of pipe-separated cells, respecting escaped pipes (\|)
 */
function parseRow(line: string): string[] {
    const trimmed = line.trim();

    // Find boundaries (same logic as parseLineCellRanges)
    let innerFrom = 0;
    let innerTo = trimmed.length;

    if (trimmed[innerFrom] === '|' && isUnescapedPipeAt(trimmed, innerFrom)) {
        innerFrom += 1;
    }
    if (innerTo > innerFrom && trimmed[innerTo - 1] === '|' && isUnescapedPipeAt(trimmed, innerTo - 1)) {
        innerTo -= 1;
    }

    // Find unescaped pipe delimiters
    const delimiters: number[] = [];
    for (let i = innerFrom; i < innerTo; i++) {
        if (isUnescapedPipeAt(trimmed, i)) {
            delimiters.push(i);
        }
    }

    // Extract cell contents
    const cells: string[] = [];
    let segmentStart = innerFrom;
    for (const delimiterIndex of delimiters) {
        cells.push(trimmed.slice(segmentStart, delimiterIndex).trim());
        segmentStart = delimiterIndex + 1;
    }
    cells.push(trimmed.slice(segmentStart, innerTo).trim());

    return cells;
}

/**
 * Check if a line is a valid separator row (contains only dashes, colons, pipes, spaces)
 */
function isSeparatorRow(line: string): boolean {
    const trimmed = line.trim();
    // Must have at least one dash
    if (!trimmed.includes('-')) return false;
    // Should only contain valid separator characters
    return /^[\s|:\-]+$/.test(trimmed);
}

/**
 * Parse markdown table text into structured TableData
 * Returns null if the text is not a valid table
 */
export function parseMarkdownTable(text: string): TableData | null {
    const lines = text.split('\n').filter((line) => line.trim().length > 0);

    if (lines.length < 2) return null;

    // First line should be the header
    const headerLine = lines[0];
    if (!headerLine.includes('|')) return null;

    // Second line should be the separator
    const separatorLine = lines[1];
    if (!isSeparatorRow(separatorLine)) return null;

    const headers = parseRow(headerLine);
    const separatorCells = parseRow(separatorLine);
    const alignments = separatorCells.map(parseAlignment);

    // Parse data rows
    const rows: string[][] = [];
    for (let i = 2; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('|')) {
            rows.push(parseRow(line));
        }
    }

    return { headers, alignments, rows };
}

function isUnescapedPipeAt(line: string, index: number): boolean {
    if (line[index] !== '|') {
        return false;
    }

    let backslashCount = 0;
    for (let i = index - 1; i >= 0 && line[i] === '\\'; i--) {
        backslashCount++;
    }

    return backslashCount % 2 === 0;
}

function getNonEmptyLinesWithOffsets(text: string): Array<{ line: string; from: number }> {
    const result: Array<{ line: string; from: number }> = [];
    const lines = text.split('\n');

    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().length > 0) {
            result.push({ line, from: offset });
        }

        offset += line.length;
        if (i < lines.length - 1) {
            offset += 1; // newline
        }
    }

    return result;
}

function findTrimBounds(line: string): { from: number; to: number } {
    let from = 0;
    let to = line.length;

    while (from < to && /\s/.test(line[from])) {
        from++;
    }
    while (to > from && /\s/.test(line[to - 1])) {
        to--;
    }

    return { from, to };
}

function trimCellBounds(line: string, from: number, to: number): { from: number; to: number } {
    let start = from;
    let end = to;

    while (start < end && /\s/.test(line[start])) {
        start++;
    }
    while (end > start && /\s/.test(line[end - 1])) {
        end--;
    }

    return { from: start, to: end };
}

function parseLineCellRanges(line: string, lineFromInTable: number): CellRange[] {
    const { from: trimFrom, to: trimTo } = findTrimBounds(line);
    if (trimTo <= trimFrom) {
        return [];
    }

    // Mirror parseRow(): remove leading/trailing pipes after trimming whitespace.
    let innerFrom = trimFrom;
    let innerTo = trimTo;
    if (line[innerFrom] === '|' && isUnescapedPipeAt(line, innerFrom)) {
        innerFrom += 1;
    }
    if (innerTo > innerFrom && line[innerTo - 1] === '|' && isUnescapedPipeAt(line, innerTo - 1)) {
        innerTo -= 1;
    }

    const delimiters: number[] = [];
    for (let i = innerFrom; i < innerTo; i++) {
        if (line[i] === '|' && isUnescapedPipeAt(line, i)) {
            delimiters.push(i);
        }
    }

    const ranges: CellRange[] = [];
    let segmentStart = innerFrom;
    for (const delimiterIndex of delimiters) {
        const segmentEnd = delimiterIndex;
        const trimmed = trimCellBounds(line, segmentStart, segmentEnd);
        ranges.push({
            from: lineFromInTable + trimmed.from,
            to: lineFromInTable + trimmed.to,
        });
        segmentStart = delimiterIndex + 1;
    }

    // Last segment
    const lastTrimmed = trimCellBounds(line, segmentStart, innerTo);
    ranges.push({
        from: lineFromInTable + lastTrimmed.from,
        to: lineFromInTable + lastTrimmed.to,
    });

    return ranges;
}

/**
 * Computes per-cell source ranges (relative to `text`) for header/body rows.
 *
 * Notes:
 * - Uses the same "non-empty line" behavior as parseMarkdownTable().
 * - Treats unescaped pipes as delimiters; escaped pipes (\|) stay inside a cell.
 * - Trims whitespace inside each cell so the returned ranges map to the rendered cell text.
 */
export function computeMarkdownTableCellRanges(text: string): TableCellRanges | null {
    const lines = getNonEmptyLinesWithOffsets(text);
    if (lines.length < 2) {
        return null;
    }

    const headerLine = lines[0];
    const separatorLine = lines[1];

    if (!headerLine.line.includes('|')) {
        return null;
    }
    if (!isSeparatorRow(separatorLine.line)) {
        return null;
    }

    const headerRanges = parseLineCellRanges(headerLine.line, headerLine.from);
    const rowRanges: CellRange[][] = [];

    for (let i = 2; i < lines.length; i++) {
        const lineInfo = lines[i];
        if (!lineInfo.line.includes('|')) {
            continue;
        }
        rowRanges.push(parseLineCellRanges(lineInfo.line, lineInfo.from));
    }

    return { headers: headerRanges, rows: rowRanges };
}
