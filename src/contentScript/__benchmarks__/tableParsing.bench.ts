import { describe, test } from 'vitest';
import { EditorSelection } from '@codemirror/state';
import { MarkdownTable } from '../tableModel/MarkdownTable';
import { computeCellAnchorForTable } from '../tableModel/cellAnchors';
import { getTableContextAtPos, getTableContexts } from '../tableState/tableContextField';
import { activeCellField, setActiveCellEffect } from '../tableState/activeCellState';
import { sourceModeField, toggleSourceModeEffect } from '../tableState/sourceMode';
import { tableDecorationField } from '../tableWidget/tableDecorationField';
import { syncAnnotation } from '../editorBridge/syncAnnotation';
import { createMarkdownState } from '../__tests__/testMarkdownState';

// Capture imported functions once so timed calls bypass Vite's module export getters.
const readTableContexts = getTableContexts;
const findTableContextAtPos = getTableContextAtPos;
const computeCellAnchor = computeCellAnchorForTable;

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
    const contexts = getTableContexts(state);
    if (contexts.length === 0) {
        throw new Error('tableContextField found no benchmark table');
    }
    const tableFrom = contexts[0].from;

    requireParsed(getTableContextAtPos(state, tableFrom), 'getTableContextAtPos');
    return { ...spec, text, table, anchorTarget, state, tableFrom };
});

for (const fixture of fixtures) {
    describe(fixture.label, () => {
        // Clipboard paste is the only path that parses text the editor has not already parsed.
        test('clipboard MarkdownTable.parse', async ({ bench }) => {
            await bench('clipboard MarkdownTable.parse', () => {
                MarkdownTable.parse(fixture.text);
            }).run(BENCHMARK_OPTIONS);
        });

        // Structural edits serialize first, then anchor using the captured line lengths.
        // Include both operations in the timing to match that runtime path.
        test('structural-edit serialize + cached anchor', async ({ bench }) => {
            await bench('structural-edit serialize + cached anchor', () => {
                const serialized = fixture.table.serializeWithOffsets();
                computeCellAnchor({ serialized, target: fixture.anchorTarget });
            }).run(BENCHMARK_OPTIONS);
        });

        test('read complete table index', async ({ bench }) => {
            await bench('read complete table index', () => {
                readTableContexts(fixture.state);
            }).run(BENCHMARK_OPTIONS);
        });

        test('indexed getTableContextAtPos', async ({ bench }) => {
            await bench('indexed getTableContextAtPos', () => {
                findTableContextAtPos(fixture.state, fixture.tableFrom);
            }).run(BENCHMARK_OPTIONS);
        });
    });
}

for (const spec of DOCUMENT_FIXTURE_SPECS) {
    const table = buildTable(3, 5);
    const document = Array.from({ length: spec.tableCount }, (_value, index) => `paragraph ${index}\n\n${table}`).join(
        '\n\n'
    );
    const noActiveState = createMarkdownState(document, [sourceModeField, activeCellField, tableDecorationField]);
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
    // Inside the trailing paragraph, so the caret never lands in a table.
    const outsideTableCaret = paragraphInsert + 1;

    describe(spec.label, () => {
        test('reuse-key slicing only', async ({ bench }) => {
            await bench('reuse-key slicing only', () => {
                for (const context of readTableContexts(noActiveState)) {
                    noActiveState.doc.sliceString(context.from, context.to);
                }
            }).run(BENCHMARK_OPTIONS);
        });

        test('no active cell: warmed paragraph edit', async ({ bench }) => {
            await bench('no active cell: warmed paragraph edit', () => {
                noActiveState
                    .update({ changes: { from: paragraphInsert, insert: 'x' } })
                    .state.field(tableDecorationField);
            }).run(BENCHMARK_OPTIONS);
        });

        test('active table near start: warmed nested-cell edit', async ({ bench }) => {
            await bench('active table near start: warmed nested-cell edit', () => {
                activeState
                    .update({
                        changes: { from: activeInsert, insert: 'x' },
                        annotations: syncAnnotation.of(true),
                    })
                    .state.field(tableDecorationField);
            }).run(BENCHMARK_OPTIONS);
        });

        test('raw mode: warmed paragraph edit', async ({ bench }) => {
            await bench('raw mode: warmed paragraph edit', () => {
                rawModeState
                    .update({ changes: { from: paragraphInsert, insert: 'x' } })
                    .state.field(tableDecorationField);
            }).run(BENCHMARK_OPTIONS);
        });

        // Selection-only transactions with unchanged index and active-cell identities keep the
        // existing decoration set. Track the no-active and active-cell variants of that fast path.
        test('no active cell: selection-only caret move', async ({ bench }) => {
            await bench('no active cell: selection-only caret move', () => {
                noActiveState
                    .update({ selection: EditorSelection.cursor(outsideTableCaret) })
                    .state.field(tableDecorationField);
            }).run(BENCHMARK_OPTIONS);
        });

        // An unchanged active cell takes the fast path without resolving it or checking
        // active-host preservation.
        test('active table near start: selection-only caret move', async ({ bench }) => {
            await bench('active table near start: selection-only caret move', () => {
                activeState
                    .update({ selection: EditorSelection.cursor(outsideTableCaret) })
                    .state.field(tableDecorationField);
            }).run(BENCHMARK_OPTIONS);
        });
    });
}
