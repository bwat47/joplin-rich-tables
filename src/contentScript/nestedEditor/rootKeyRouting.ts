import { CLASS_CELL_EDITOR } from '../shared/tableDomClasses';

/**
 * Keydowns from a nested cell editor that the root editor should handle. They are keyed by the
 * event itself, so nothing is retained once the event is gone.
 */
const rootEditorKeyEvents = new WeakSet<Event>();

/** Lets the root editor handle this nested-editor keydown when it bubbles up (e.g. formatting commands). */
export function routeKeyEventToRootEditor(event: KeyboardEvent): void {
    rootEditorKeyEvents.add(event);
}

/**
 * True for a keydown from inside a nested cell editor that was not routed to the root editor.
 *
 * Nested-editor keydowns bubble normally so Joplin and document-level listeners see them, but
 * the root editor must ignore them: its keymap would act on a root selection that can sit
 * outside the cell (e.g. Backspace deleting a table pipe).
 */
export function isNestedEditorKeyEvent(event: Event): boolean {
    if (event.type !== 'keydown' || rootEditorKeyEvents.has(event)) {
        return false;
    }

    const target = event.target as Node | null;
    const element = target?.nodeType === Node.ELEMENT_NODE ? (target as Element) : (target?.parentElement ?? null);
    return element?.closest(`.${CLASS_CELL_EDITOR}`) != null;
}
