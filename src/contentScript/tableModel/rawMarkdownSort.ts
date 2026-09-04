export type TableSortDirection = 'ascending' | 'descending';

const rawMarkdownCollator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
});

function isBlankCell(value: string): boolean {
    return value.trim().length === 0;
}

/**
 * Compares raw Markdown cell content without interpreting its rendered meaning.
 * Numeric collation keeps embedded digit runs natural, for example `Item 2` before
 * `Item 10`. Blank cells remain last in both directions.
 */
export function compareRawMarkdownCells(a: string, b: string, direction: TableSortDirection): number {
    const aIsBlank = isBlankCell(a);
    const bIsBlank = isBlankCell(b);

    if (aIsBlank || bIsBlank) {
        if (aIsBlank === bIsBlank) {
            return 0;
        }

        return aIsBlank ? 1 : -1;
    }

    const result = rawMarkdownCollator.compare(a, b);
    return direction === 'ascending' ? result : -result;
}
