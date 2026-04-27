export const REQUIRED_TABLE_BOUNDARY_BLANK_LINES = 1;

export function countTrailingBlankLinesBeforeBoundary(text: string): number {
    if (text.length === 0 || !text.endsWith('\n')) {
        return 0;
    }

    const lines = text.split('\n');
    let index = lines.length - 2;
    let blankLineCount = 0;

    while (index >= 0 && lines[index].trim().length === 0) {
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

    while (index < lines.length && lines[index].trim().length === 0) {
        blankLineCount++;
        index++;
    }

    return blankLineCount;
}
