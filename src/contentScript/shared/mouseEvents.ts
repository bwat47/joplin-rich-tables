/** `MouseEvent.button` value for the primary (left) button. */
const MOUSE_BUTTON_LEFT = 0;

/** True for a left-button mouse event. */
export function isPrimaryMouseButton(event: MouseEvent): boolean {
    return event.button === MOUSE_BUTTON_LEFT;
}

/**
 * True for the left button of the primary mouse pointer.
 *
 * Touch and pen pointers are excluded: they keep their native scroll and tap behaviour.
 */
export function isPrimaryMousePointer(event: PointerEvent): boolean {
    return event.pointerType === 'mouse' && event.isPrimary && isPrimaryMouseButton(event);
}

/**
 * What a press does to the event that carried it.
 *
 * - `native`: left entirely alone, for a press whose owner is the browser or another editor.
 * - `claim`: taken from CodeMirror's handlers, with the browser default left to run.
 * - `consume`: taken from both.
 *
 * `EditorView.domEventHandlers` cannot express `claim`: a handler returning true also calls
 * `preventDefault`. That is why presses are dispatched from a capture listener instead.
 */
export type PressDisposition = 'native' | 'claim' | 'consume';

/** Applies what {@link PressDisposition} says about an event to the event itself. */
export function applyPressDisposition(event: Event, disposition: PressDisposition): void {
    if (disposition === 'native') {
        return;
    }

    event.stopPropagation();
    if (disposition === 'consume') {
        event.preventDefault();
    }
}
