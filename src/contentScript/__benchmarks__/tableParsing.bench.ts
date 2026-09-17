import { bench, describe } from 'vitest';
import { MarkdownTable } from '../tableModel/MarkdownTable';
import { computeCellAnchorForTable } from '../tableModel/cellAnchors';
import { getTableContextAtPos, getTableContexts } from '../tableState/tableContextField';
import { activeCellField, setActiveCellEffect } from '../tableState/activeCellState';
import { sourceModeField, toggleSourceModeEffect } from '../tableState/sourceMode';
import { resolvedActiveCellField } from '../tableRuntime/activeCell/resolvedActiveCell';
import { tableDecorationField } from '../tableWidget/tableDecorationField';
import { syncAnnotation } from '../editorBridge/syncAnnotation';
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

const DOCUMENT_FIXTURE_SPECS = [
    { label: '200-table document', tableCount: 200 },
    { label: '1000-table stress document', tableCount: 1000 },
] as const;

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
    const table = requireParsed(MarkdownTable.parse(text), 'MarkdownTable.parse');
    // Bottom-right is the worst case: the offset walk passes every preceding row and cell.
    const anchorTarget = { section: 'body', row: spec.bodyRows - 1, col: spec.columns - 1 } as const;
    const state = createMarkdownState(text);
    const tableFrom = getTableContexts(state)[0]?.from;
    if (tableFrom === undefined) {
        throw new Error('tableContextField found no benchmark table');
    }

    requireParsed(getTableContextAtPos(state, tableFrom), 'getTableContextAtPos');
    return { ...spec, text, table, anchorTarget, state, tableFrom };
});

for (const fixture of fixtures) {
    describe(fixture.label, () => {
        // Clipboard paste is the only path that parses text the editor has not already parsed.
        bench(
            'clipboard MarkdownTable.parse',
            () => {
                MarkdownTable.parse(fixture.text);
            },
            BENCHMARK_OPTIONS
        );

        // Structural edits serialize first, then anchor using the captured line lengths.
        // Include both operations in the timing to match that runtime path.
        bench(
            'structural-edit serialize + cached anchor',
            () => {
                const serialized = fixture.table.serializeWithOffsets();
                computeCellAnchorForTable({ serialized, target: fixture.anchorTarget });
            },
            BENCHMARK_OPTIONS
        );

        bench(
            'read complete table index',
            () => {
                getTableContexts(fixture.state);
            },
            BENCHMARK_OPTIONS
        );

        bench(
            'indexed getTableContextAtPos',
            () => {
                getTableContextAtPos(fixture.state, fixture.tableFrom);
            },
            BENCHMARK_OPTIONS
        );
    });
}

for (const spec of DOCUMENT_FIXTURE_SPECS) {
    const table = buildTable(3, 5);
    const document = Array.from({ length: spec.tableCount }, (_value, index) => `paragraph ${index}\n\n${table}`).join(
        '\n\n'
    );
    const noActiveState = createMarkdownState(document, [
        sourceModeField,
        activeCellField,
        resolvedActiveCellField,
        tableDecorationField,
    ]);
    const firstContext = getTableContexts(noActiveState)[0];
    if (!firstContext) {
        throw new Error('tableContextField found no document benchmark table');
    }
    const activeState = noActiveState.update({
        effects: setActiveCellEffect.of({ tableFrom: firstContext.from, section: 'body', row: 0, col: 0 }),
    }).state;
    const rawModeState = noActiveState.update({ effects: toggleSourceModeEffect.of(true) }).state;
    const activeCell = firstContext.cellRanges.rows[0][0];
    const activeInsert = firstContext.from + activeCell.editableFrom;
    const paragraphInsert = document.lastIndexOf('paragraph');

    describe(spec.label, () => {
        bench(
            'reuse-key slicing only',
            () => {
                for (const context of getTableContexts(noActiveState)) {
                    noActiveState.doc.sliceString(context.from, context.to);
                }
            },
            BENCHMARK_OPTIONS
        );

        bench(
            'no active cell: warmed paragraph edit',
            () => {
                noActiveState
                    .update({ changes: { from: paragraphInsert, insert: 'x' } })
                    .state.field(tableDecorationField);
            },
            BENCHMARK_OPTIONS
        );

        bench(
            'active table near start: warmed nested-cell edit',
            () => {
                activeState
                    .update({
                        changes: { from: activeInsert, insert: 'x' },
                        annotations: syncAnnotation.of(true),
                    })
                    .state.field(tableDecorationField);
            },
            BENCHMARK_OPTIONS
        );

        bench(
            'raw mode: warmed paragraph edit',
            () => {
                rawModeState
                    .update({ changes: { from: paragraphInsert, insert: 'x' } })
                    .state.field(tableDecorationField);
            },
            BENCHMARK_OPTIONS
        );
    });
}
