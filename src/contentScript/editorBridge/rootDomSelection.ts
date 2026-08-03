import type { EditorView } from '@codemirror/view';
import { getViewDocument } from '../shared/domContext';
import { clamp } from '../shared/numberUtils';
import { logger } from '../../logger';

interface DomSelectionEndpoint {
    node: Node;
    offset: number;
}

function clampPosition(view: EditorView, pos: number): number {
    return clamp(pos, 0, view.state.doc.length);
}

function getDomSelectionEndpoint(view: EditorView, pos: number, side: -1 | 1): DomSelectionEndpoint | null {
    try {
        return view.domAtPos(clampPosition(view, pos), side);
    } catch (e) {
        logger.debug('domAtPos threw resolving position', pos, e);
        return null;
    }
}

function isSelectionEndpointInView(view: EditorView, endpoint: DomSelectionEndpoint): boolean {
    return view.contentDOM.contains(endpoint.node);
}

/**
 * Fallback for browsers without `Selection.setBaseAndExtent`. A DOM Range has no
 * direction, so callers must pass the endpoints in document order: for a backward
 * selection that means `head` first.
 */
function setDomSelectionRange(
    documentSelection: Selection,
    doc: Document,
    start: DomSelectionEndpoint,
    end: DomSelectionEndpoint
): void {
    const range = doc.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    documentSelection.removeAllRanges();
    documentSelection.addRange(range);
}

/**
 * Mirrors CodeMirror's state selection into the browser DOM selection even when
 * the root editor is blurred. This keeps host editor focus restoration from
 * reconciling against a stale DOM selection after command-driven root edits.
 * Required since @codemirror/view 6.35.3, which no longer updates the DOM selection
 * when the editor is unfocused but focusable, see: https://github.com/codemirror/view/commit/c946a84
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
    if (!anchor || !head) {
        return false;
    }
    if (!isSelectionEndpointInView(view, anchor) || !isSelectionEndpointInView(view, head)) {
        return false;
    }

    try {
        if (documentSelection.setBaseAndExtent) {
            documentSelection.setBaseAndExtent(anchor.node, anchor.offset, head.node, head.offset);
        } else if (forward) {
            setDomSelectionRange(documentSelection, doc, anchor, head);
        } else {
            setDomSelectionRange(documentSelection, doc, head, anchor);
        }
        return true;
    } catch {
        return false;
    }
}
