import type { EditorView } from '@codemirror/view';
import type { TableContext } from '../tableModel/tableContext';
import { getWidgetSelector } from '../tableWidget/domHelpers';
import { getResolvedActiveCell } from './activeCell/resolvedActiveCell';
import { resolveTableContextAtPos } from './tableResolution';

/**
 * Resolve a table context from an event target, using a best-effort set of fallbacks.
 *
 * Order:
 * 1) DOM -> doc position via `view.posAtDOM`
 * 2) Widget container -> doc position via `view.posAtDOM`
 * 3) Active cell fallback (when nested editor is open)
 */
export function resolveTableContextFromEventTarget(view: EditorView, target: HTMLElement): TableContext | null {
    // Best case: map DOM->doc position.
    try {
        const pos = view.posAtDOM(target, 0);
        const context = resolveTableContextAtPos(view.state, pos);
        if (context) {
            return context;
        }
    } catch {
        // Some DOM nodes inside replacement widgets can fail `posAtDOM`.
    }

    // Next best: try mapping the widget container itself. This avoids relying on
    // potentially-stale dataset anchors when decorations are mapped through edits
    // while a nested editor is open.
    const container = target.closest(getWidgetSelector()) as HTMLElement | null;
    if (container) {
        try {
            const pos = view.posAtDOM(container, 0);
            const context = resolveTableContextAtPos(view.state, pos);
            if (context) {
                return context;
            }
        } catch {
            // Fall through to activeCell fallback.
        }
    }

    // Fallback: use the persisted active cell identity when nested editing has
    // detached the event target from a reliable document position.
    const activeCellContext = getResolvedActiveCell(view.state)?.ctx ?? null;
    if (activeCellContext) {
        return activeCellContext;
    }

    return null;
}
