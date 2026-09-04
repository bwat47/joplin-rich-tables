import { MarkdownTable } from '../tableModel/MarkdownTable';

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
