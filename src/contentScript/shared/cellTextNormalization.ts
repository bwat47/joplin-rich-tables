const NON_CANONICAL_BR_PATTERN = /<br\s*\/>/gi;

export function normalizeBrTags(text: string): string {
    return text.replaceAll(NON_CANONICAL_BR_PATTERN, '<br>');
}
