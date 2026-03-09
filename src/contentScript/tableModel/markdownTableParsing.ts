/**
 * Transitional parsing wrapper for code paths that still consume TableData.
 * Canonical parsing ownership now lives in `MarkdownTable.parse()`.
 */
import { MarkdownTable, type TableAlignment } from './MarkdownTable';

/**
 * Represents a parsed markdown table structure.
 */
export interface TableData {
    headers: string[];
    alignments: TableAlignment[];
    rows: string[][];
}

/**
 * Parse markdown table text into structured TableData.
 * Returns null if the text is not a valid table.
 */
export function parseMarkdownTable(text: string): TableData | null {
    return MarkdownTable.parse(text)?.toData() ?? null;
}
