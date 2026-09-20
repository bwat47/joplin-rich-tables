import type { Text } from '@codemirror/state';

export const REQUIRED_TABLE_BOUNDARY_BLANK_LINES = 1;

/** True when text contains only whitespace and can therefore form a blank line. */
export function isBlankLineContent(text: string): boolean {
    return text.trim().length === 0;
}

/**
 * True when `pos` already has the required blank lines above its line.
 *
 * Document edges count as unseparated: walking off the start of the note before finding
 * those blank lines means the table still needs padding. Line lookups keep this cheap
 * enough to run on every keystroke.
 */
export function hasRequiredBlankLinesBefore(doc: Text, pos: number): boolean {
    let lineNumber = doc.lineAt(pos).number;
    for (let remaining = REQUIRED_TABLE_BOUNDARY_BLANK_LINES; remaining > 0; remaining--) {
        lineNumber--;
        if (lineNumber < 1) {
            return false;
        }
        if (!isBlankLineContent(doc.line(lineNumber).text)) {
            return false;
        }
    }
    return true;
}

/** True when `pos` already has the required blank lines below its line. Document end is unseparated. */
export function hasRequiredBlankLinesAfter(doc: Text, pos: number): boolean {
    let lineNumber = doc.lineAt(pos).number;
    for (let remaining = REQUIRED_TABLE_BOUNDARY_BLANK_LINES; remaining > 0; remaining--) {
        lineNumber++;
        if (lineNumber > doc.lines) {
            return false;
        }
        if (!isBlankLineContent(doc.line(lineNumber).text)) {
            return false;
        }
    }
    return true;
}

/**
 * True when a table edge at `pos` still needs a blank-line separator above it.
 *
 * A missing line start counts, so a mid-line caret is unseparated from the text on that line.
 * Document start counts as unseparated even when everything before `pos` is empty or blank.
 */
export function needsLeadingSeparator(doc: Text, pos: number): boolean {
    return doc.lineAt(pos).from !== pos || !hasRequiredBlankLinesBefore(doc, pos);
}

/**
 * True when a table edge at `pos` still needs a blank-line separator below it.
 *
 * A missing line end counts, so a suffix is needed to split a merged neighbour off the table.
 * Document end counts as unseparated even when everything after `pos` is empty or blank.
 */
export function needsTrailingSeparator(doc: Text, pos: number): boolean {
    return doc.lineAt(pos).to !== pos || !hasRequiredBlankLinesAfter(doc, pos);
}
