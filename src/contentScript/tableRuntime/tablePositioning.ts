import type { EditorView } from '@codemirror/view';
import type { TableContext } from '../tableModel/tableContext';
import { getTableContextAtPos } from '../tableState/tableContextField';

/**
 * Resolves the table whose widget contains an event target.
 *
 * `posAtDOM` maps any node inside a table widget, including a hosted nested editor's DOM, to
 * the widget's start, and widgets sit exactly on the index's table spans.
 */
export function resolveTableContextFromEventTarget(view: EditorView, target: HTMLElement): TableContext | null {
    return getTableContextAtPos(view.state, view.posAtDOM(target));
}
