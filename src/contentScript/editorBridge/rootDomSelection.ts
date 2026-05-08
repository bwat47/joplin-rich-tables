import type { EditorView } from '@codemirror/view';
import { getViewDocument } from '../shared/domContext';

interface DomSelectionEndpoint {
    node: Node;
    offset: number;
}

function clampPosition(view: EditorView, pos: number): number {
    return Math.max(0, Math.min(view.state.doc.length, pos));
}

function getDomSelectionEndpoint(view: EditorView, pos: number, side: -1 | 1): DomSelectionEndpoint {
    return view.domAtPos(clampPosition(view, pos), side);
}

function isSelectionEndpointInView(view: EditorView, endpoint: DomSelectionEndpoint): boolean {
    return view.contentDOM.contains(endpoint.node);
}

function setForwardDomSelection(
    documentSelection: Selection,
    doc: Document,
    anchor: DomSelectionEndpoint,
    head: DomSelectionEndpoint
): void {
    const range = doc.createRange();
    range.setStart(anchor.node, anchor.offset);
    range.setEnd(head.node, head.offset);
    documentSelection.removeAllRanges();
    documentSelection.addRange(range);
}

/**
 * Mirrors CodeMirror's state selection into the browser DOM selection even when
 * the root editor is blurred. This keeps host editor focus restoration from
 * reconciling against a stale DOM selection after command-driven root edits.
 */
export function forceRootDomSelection(view: EditorView, selection: { anchor: number; head: number }): boolean {
    const doc = getViewDocument(view);
    const documentSelection = doc.getSelection();
    if (!documentSelection) {
        return false;
    }

    const forward = selection.anchor <= selection.head;
    const anchor = getDomSelectionEndpoint(view, selection.anchor, forward ? -1 : 1);
    const head = getDomSelectionEndpoint(view, selection.head, forward ? 1 : -1);
    if (!isSelectionEndpointInView(view, anchor) || !isSelectionEndpointInView(view, head)) {
        return false;
    }

    try {
        if (documentSelection.setBaseAndExtent) {
            documentSelection.setBaseAndExtent(anchor.node, anchor.offset, head.node, head.offset);
        } else if (forward) {
            setForwardDomSelection(documentSelection, doc, anchor, head);
        } else {
            setForwardDomSelection(documentSelection, doc, head, anchor);
        }
        return true;
    } catch {
        return false;
    }
}
