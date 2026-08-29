import type { Text } from '@codemirror/state';

export const REQUIRED_TABLE_BOUNDARY_BLANK_LINES = 1;

/** True when text contains only whitespace and can therefore form a blank line. */
export function isBlankLineContent(text: string): boolean {
    return text.trim().length === 0;
}

export function countTrailingBlankLinesBeforeBoundary(text: string): number {
    if (text.length === 0 || !text.endsWith('\n')) {
        return 0;
    }

    const lines = text.split('\n');
    let index = lines.length - 2;
    let blankLineCount = 0;

    while (index >= 0 && isBlankLineContent(lines[index])) {
        blankLineCount++;
        index--;
    }

    return blankLineCount;
}

export function countLeadingBlankLinesAfterBoundary(text: string): number {
    if (text.length === 0 || !text.startsWith('\n')) {
        return 0;
    }

    const lines = text.split('\n');
    let index = 1;
    let blankLineCount = 0;

    while (index < lines.length && isBlankLineContent(lines[index])) {
        blankLineCount++;
        index++;
    }

    return blankLineCount;
}

/**
 * True when `pos` already has the required blank lines above its line.
 *
 * The document start counts as separated: there is no neighbouring text to run into.
 * Line lookups keep this cheap enough to run on every keystroke, unlike the slice-based
 * counters above.
 */
export function hasRequiredBlankLinesBefore(doc: Text, pos: number): boolean {
    let lineNumber = doc.lineAt(pos).number;
    for (let remaining = REQUIRED_TABLE_BOUNDARY_BLANK_LINES; remaining > 0; remaining--) {
        lineNumber--;
        if (lineNumber < 1) {
            return true;
        }
        if (!isBlankLineContent(doc.line(lineNumber).text)) {
            return false;
        }
    }
    return true;
}

/** True when `pos` already has the required blank lines below its line. */
export function hasRequiredBlankLinesAfter(doc: Text, pos: number): boolean {
    let lineNumber = doc.lineAt(pos).number;
    for (let remaining = REQUIRED_TABLE_BOUNDARY_BLANK_LINES; remaining > 0; remaining--) {
        lineNumber++;
        if (lineNumber > doc.lines) {
            return true;
        }
        if (!isBlankLineContent(doc.line(lineNumber).text)) {
            return false;
        }
    }
    return true;
}
