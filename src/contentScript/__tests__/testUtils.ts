import { MarkdownTable } from '../tableModel/MarkdownTable';
import { parseRootMarkdownTableSyntax } from '../tableModel/lezerTableSyntax';
import { computeMarkdownTableCellRangesFromSyntax, type TableCellRanges } from '../tableModel/markdownTableCellRanges';

/** Parses a real Markdown fixture into source-relative ranges, failing on invalid input. */
export function parseCellRangesFixture(text: string): TableCellRanges {
    const parsed = parseRootMarkdownTableSyntax(text);
    if (!parsed) {
        throw new Error('Expected a valid root table fixture for cell ranges');
    }
    return computeMarkdownTableCellRangesFromSyntax(text, parsed.syntax, parsed.from);
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
