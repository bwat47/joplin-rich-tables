/**
 * Markdown table sources pad cells and line ends with ASCII spaces and tabs.
 * Padding is layout, not content: other Unicode whitespace stays cell content.
 */

export function isTablePadding(character: string | undefined): boolean {
    return character === ' ' || character === '\t';
}

/** Returns `text` without its trailing padding. */
export function trimTablePaddingEnd(text: string): string {
    let end = text.length;
    while (end > 0 && isTablePadding(text[end - 1])) {
        end--;
    }
    return text.slice(0, end);
}
