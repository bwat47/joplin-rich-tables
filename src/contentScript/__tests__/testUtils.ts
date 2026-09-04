import { parseRootMarkdownTableSyntax, type MarkdownTableSyntax } from '../tableModel/lezerTableSyntax';

export function parseTableSyntaxFixture(text: string): MarkdownTableSyntax {
    const parsed = parseRootMarkdownTableSyntax(text);
    if (!parsed) {
        throw new Error('Expected valid root table fixture');
    }
    return parsed.syntax;
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
