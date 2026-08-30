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
