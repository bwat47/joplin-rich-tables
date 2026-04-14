import type { EditorView } from '@codemirror/view';

export function getNodeDocument(node: Node): Document {
    return node.ownerDocument ?? document;
}

export function getDocumentWindow(doc: Document): Window {
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
