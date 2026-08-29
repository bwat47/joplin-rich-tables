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
