/**
 * Scans a markdown table row and returns indices of pipe delimiters.
 *
 * IMPORTANT: All table cell boundary logic MUST use this scanner. Do not split on '|' manually.
 *
 * Handles: escaped pipes (\|).
 *
 * Architecture:
 * 1. Lezer detects table blocks (Table/TableRow nodes)
 * 2. This scanner detects cell boundaries
 * 3. All plugin code uses this scanner (single source of truth)
 *
 */

export interface TableRowScanResult {
    readonly delimiters: number[];
}

export function scanMarkdownTableRow(line: string): TableRowScanResult {
    const delimiters: number[] = [];
    let isEscaped = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];

        if (isEscaped) {
            isEscaped = false;
            continue;
        }

        if (ch === '\\') {
            isEscaped = true;
            continue;
        }

        if (ch === '|') {
            delimiters.push(i);
        }
    }

    return { delimiters };
}
