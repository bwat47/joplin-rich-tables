import { CLASS_CELL_EDITOR } from '../shared/tableDomClasses';

/**
 * Keyboard and text-input events a nested cell editor owns. The root editor must not see them:
 * its keymap would act on a root selection that can sit outside the cell (e.g. Backspace deleting
 * a table pipe), and its input/composition tracking would treat nested typing as its own.
 */
const NESTED_EDITOR_OWNED_EVENT_TYPES: ReadonlySet<string> = new Set([
    'keydown',
    'beforeinput',
    'input',
    'compositionstart',
    'compositionupdate',
    'compositionend',
]);

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
 * True for a keyboard or text-input event from inside a nested cell editor that was not routed to
 * the root editor.
 *
 * These events bubble normally so Joplin and document-level listeners see them; the root editor
 * ignores them through `TableWidget.ignoreEvent`.
 */
export function isNestedEditorOwnedEvent(event: Event): boolean {
    if (!NESTED_EDITOR_OWNED_EVENT_TYPES.has(event.type) || rootEditorKeyEvents.has(event)) {
        return false;
    }

    const target = event.target as Node | null;
    const element = target?.nodeType === Node.ELEMENT_NODE ? (target as Element) : (target?.parentElement ?? null);
    return element?.closest(`.${CLASS_CELL_EDITOR}`) != null;
}
