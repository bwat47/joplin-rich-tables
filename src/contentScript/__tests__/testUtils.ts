type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: unknown) => void;
};

const promiseConstructor = Promise as PromiseConstructor & {
    withResolvers<T>(): Deferred<T>;
};

export function deferred<T>(): Deferred<T> {
    return promiseConstructor.withResolvers<T>();
}
