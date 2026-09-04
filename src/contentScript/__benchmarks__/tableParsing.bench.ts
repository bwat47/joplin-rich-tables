import { bench, describe } from 'vitest';
import { MarkdownTable } from '../tableModel/MarkdownTable';
import { computeMarkdownTableCellRanges } from '../tableModel/markdownTableCellRanges';
import { resolveTableContextAtPos, findTableRanges } from '../tableRuntime/tableResolution';
import { createMarkdownState } from '../__tests__/testMarkdownState';

interface TableFixtureSpec {
    readonly label: string;
    readonly bodyRows: number;
    readonly columns: number;
}

const BENCHMARK_OPTIONS = {
    time: 500,
    warmupTime: 100,
    iterations: 10,
    warmupIterations: 5,
} as const;

const FIXTURE_SPECS: readonly TableFixtureSpec[] = [
    { label: 'small 10x5', bodyRows: 10, columns: 5 },
    { label: 'medium 100x10', bodyRows: 100, columns: 10 },
    { label: 'large 1000x20', bodyRows: 1000, columns: 20 },
    { label: 'wide 100x128', bodyRows: 100, columns: 128 },
];

const CACHE_CHURN_TABLE_COUNT = 64;

function bodyCell(row: number, column: number, columns: number, variant: number): string {
    const index = row * columns + column + variant;
    const pattern = index % 31;
    if (pattern === 0 || pattern === 1) {
        return '';
    }
    if (pattern === 2) {
        return String.raw`escaped\|pipe`;
    }
    return `r${row}c${column}v${variant}`;
}

function buildTable(bodyRows: number, columns: number, variant = 0): string {
    const header = Array.from({ length: columns }, (_value, column) => `H${column}v${variant}`);
    const separator = Array.from({ length: columns }, () => '---');
    const rows = Array.from({ length: bodyRows }, (_value, row) =>
        Array.from({ length: columns }, (_cell, column) => bodyCell(row, column, columns, variant))
    );

    return [header, separator, ...rows].map((cells) => `| ${cells.join(' | ')} |`).join('\n');
}

function requireParsed<T>(value: T | null, operation: string): T {
    if (value === null) {
        throw new Error(`${operation} rejected a benchmark fixture`);
    }
    return value;
}

const fixtures = FIXTURE_SPECS.map((spec) => {
    const text = buildTable(spec.bodyRows, spec.columns);
    const state = createMarkdownState(text);
    const tableFrom = requireParsed(findTableRanges(state), 'findTableRanges')[0]?.from;
    if (tableFrom === undefined) {
        throw new Error('findTableRanges found no benchmark table');
    }

    // Complete incremental parsing and warm the TableContext LRU before timings begin.
    requireParsed(resolveTableContextAtPos(state, tableFrom), 'resolveTableContextAtPos');
    return { ...spec, text, state, tableFrom };
});

for (const fixture of fixtures) {
    describe(fixture.label, () => {
        bench(
            'standalone MarkdownTable.parse',
            () => {
                MarkdownTable.parse(fixture.text);
            },
            BENCHMARK_OPTIONS
        );

        bench(
            'standalone computeMarkdownTableCellRanges',
            () => {
                computeMarkdownTableCellRanges(fixture.text);
            },
            BENCHMARK_OPTIONS
        );

        bench(
            'existing-tree findTableRanges',
            () => {
                findTableRanges(fixture.state);
            },
            BENCHMARK_OPTIONS
        );

        bench(
            'warm resolveTableContextAtPos',
            () => {
                resolveTableContextAtPos(fixture.state, fixture.tableFrom);
            },
            BENCHMARK_OPTIONS
        );
    });
}

const cacheChurnFixtures = Array.from({ length: CACHE_CHURN_TABLE_COUNT }, (_value, variant) => {
    const text = buildTable(100, 10, variant);
    const state = createMarkdownState(text);
    const tableFrom = requireParsed(findTableRanges(state), 'findTableRanges')[0]?.from;
    if (tableFrom === undefined) {
        throw new Error('findTableRanges found no cache-churn table');
    }
    return { state, tableFrom };
});
let cacheChurnIndex = 0;

describe('medium 100x10 cache churn', () => {
    bench(
        'resolveTableContextAtPos across 64 tables',
        () => {
            const fixture = cacheChurnFixtures[cacheChurnIndex];
            cacheChurnIndex = (cacheChurnIndex + 1) % cacheChurnFixtures.length;
            resolveTableContextAtPos(fixture.state, fixture.tableFrom);
        },
        BENCHMARK_OPTIONS
    );
});
