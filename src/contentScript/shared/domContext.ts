import type { EditorView } from '@codemirror/view';

function getNodeDocument(node: Node): Document {
    return node.ownerDocument ?? document;
}

export function getDocumentWindow(doc: Document): Window {
    // `globalThis` is typed as `typeof globalThis`, which is not assignable to
    // `Window` (it lacks `name`). The alternatives are a double cast that
    // defeats type checking, or this.
    // eslint-disable-next-line unicorn/prefer-global-this
    return doc.defaultView ?? window;
}

export function getViewDocument(view: EditorView): Document {
    return getNodeDocument(view.dom);
}

export function getViewWindow(view: EditorView): Window {
    return getDocumentWindow(getViewDocument(view));
}

export function requestViewAnimationFrame(view: EditorView, callback: FrameRequestCallback): number {
    return getViewWindow(view).requestAnimationFrame(callback);
}
