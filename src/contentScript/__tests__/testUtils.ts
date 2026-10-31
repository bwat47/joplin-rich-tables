import type { EditorState, StateEffect, TransactionSpec } from '@codemirror/state';

import { parseRootMarkdownTableSyntax } from '../tableModel/lezerTableSyntax';
import { MarkdownTable } from '../tableModel/MarkdownTable';
import {
    computeMarkdownTableCellRangesFromSyntax,
    type CellRange,
    type TableCellRanges,
} from '../tableModel/markdownTableCellRanges';
import { getResolvedActiveCell, type ResolvedActiveCell } from '../tableState/resolvedActiveCell';

/** Parses a real Markdown fixture into table-relative ranges, failing on invalid input. */
export function parseCellRangesFixture(text: string): TableCellRanges {
    const parsed = parseRootMarkdownTableSyntax(text);
    if (!parsed) {
        throw new Error('Expected a valid root table fixture for cell ranges');
    }
    return computeMarkdownTableCellRangesFromSyntax(parsed.tableText, parsed.syntax);
}

/** The body cell range at `row`, `col`, failing when the fixture has no such cell. */
export function requireBodyCellRange(ranges: TableCellRanges, row: number, col: number): CellRange {
    const range = ranges.rows[row]?.[col];
    if (!range) {
        throw new Error(`Expected a body cell range at row ${row}, col ${col}`);
    }
    return range;
}

/** The effects a dispatched spec carries, as an array whether it named none, one or many. */
export function getDispatchedEffects(spec: TransactionSpec): readonly StateEffect<unknown>[] {
    const dispatchedEffects = spec.effects ?? [];
    const effects: readonly StateEffect<unknown>[] = Array.isArray(dispatchedEffects)
        ? dispatchedEffects
        : [dispatchedEffects];
    return effects;
}

export function parseTableFixture(text: string): MarkdownTable {
    const table = MarkdownTable.parse(text);
    if (!table) {
        throw new Error('Expected a valid root table fixture');
    }
    return table;
}

export function deferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: unknown) => void;
} {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });

    return { promise, resolve, reject };
}

/** Parses markup into a fragment, matching what the markdown renderer hands its callers. */
export function htmlFragment(html: string): DocumentFragment {
    const template = document.createElement('template');
    template.innerHTML = html;
    return template.content;
}

/** Reads a fragment back as markup, so assertions can stay string-based. */
export function fragmentHtml(fragment: DocumentFragment): string {
    const container = document.createElement('div');
    container.appendChild(fragment);
    return container.innerHTML;
}

/** The state's active cell resolved against its table, failing when it does not resolve. */
export function requireResolvedActiveCell(state: EditorState): ResolvedActiveCell {
    const resolvedCell = getResolvedActiveCell(state);
    if (!resolvedCell) {
        throw new Error('Expected the active cell to resolve');
    }
    return resolvedCell;
}
