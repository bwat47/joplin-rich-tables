import type { TableData } from '../tableModel/markdownTableParsing';

// Height estimation constants
const ROW_HEIGHT_BASE = 35; // Approx px per row (including padding/border)
const WRAP_CHARS = 60; // Approx chars before wrapping
const WRAP_HEIGHT = 20; // Additional px per wrapped line
const IMAGE_HEIGHT = 100; // Approx px per image
const CONTAINER_PADDING = 20; // Buffer for container padding

/**
 * Estimates the rendered height of a table based on its content.
 * This helps CodeMirror's scroll position calculations by providing
 * a reasonable height before the table is actually rendered.
 */
export function estimateTableHeight(tableData: TableData): number {
    let totalHeight = 0;

    // Header height
    totalHeight += ROW_HEIGHT_BASE;

    // Body rows
    for (const row of tableData.rows) {
        let maxRowHeight = ROW_HEIGHT_BASE;

        for (const cell of row) {
            let cellHeight = ROW_HEIGHT_BASE;
            const textLength = cell.length;

            // Estimate text wrapping
            if (textLength > WRAP_CHARS) {
                const extraLines = Math.floor(textLength / WRAP_CHARS);
                cellHeight += extraLines * WRAP_HEIGHT;
            }

            // Estimate images (naive check)
            const imageCount = (cell.match(/!\[.*?\]\(.*?\)/g) || []).length;
            if (imageCount > 0) {
                cellHeight += imageCount * IMAGE_HEIGHT;
            }

            if (cellHeight > maxRowHeight) {
                maxRowHeight = cellHeight;
            }
        }
        totalHeight += maxRowHeight;
    }

    return totalHeight + CONTAINER_PADDING;
}
