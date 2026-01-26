/**
 * Touch tap-vs-scroll guard for reliable touch input on mobile devices.
 *
 * Problem: `mousedown` events are synthesized from touch events, but the
 * synthesis behavior varies across devices/WebViews. Some devices
 * may not reliably fire `mousedown` on tap.
 *
 * Solution: Use pointer events to detect deliberate taps (vs scroll gestures)
 * by tracking movement between pointerdown and pointerup. If movement is
 * within a threshold (12px), treat it as a tap.
 *
 * Each handler (table interactions, close on outside) uses a separate context
 * to prevent them from consuming each other's tracking state.
 */

import { logger } from '../../logger';

/** Maximum distance (px) between pointerdown and pointerup to qualify as a tap */
const TAP_DISTANCE_THRESHOLD = 12;

/** Context identifiers for different touch handlers */
export type TouchContext = 'table' | 'closeOutside';

interface TouchState {
    /** Which handler started this tracking */
    context: TouchContext;
    /** Pointer ID being tracked */
    pointerId: number;
    /** Starting X coordinate */
    startX: number;
    /** Starting Y coordinate */
    startY: number;
    /** Whether pointer has moved beyond tap threshold */
    moved: boolean;
    /** Target element at pointerdown */
    target: HTMLElement;
}

/** Active touch state, null when no touch is being tracked */
let activeTouch: TouchState | null = null;

/**
 * Check if pointer event is from a touch input (not mouse/pen).
 */
function isTouchPointer(event: PointerEvent): boolean {
    return event.pointerType === 'touch';
}

/**
 * Handle pointerdown - start tracking touch gestures.
 * @param context Which handler is starting the tracking
 * Returns true if this is a touch event that should be tracked.
 */
export function handlePointerDown(event: PointerEvent, context: TouchContext): boolean {
    if (!isTouchPointer(event)) {
        return false;
    }

    const target = event.target as HTMLElement | null;
    if (!target) {
        return false;
    }

    activeTouch = {
        context,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        target,
    };

    logger.debug('Touch started', { context, pointerId: event.pointerId, x: event.clientX, y: event.clientY });
    return true;
}

/**
 * Handle pointermove - detect if gesture is a scroll (not a tap).
 */
export function handlePointerMove(event: PointerEvent): void {
    if (!activeTouch || event.pointerId !== activeTouch.pointerId) {
        return;
    }

    if (activeTouch.moved) {
        return; // Already determined to be a scroll
    }

    const dx = event.clientX - activeTouch.startX;
    const dy = event.clientY - activeTouch.startY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > TAP_DISTANCE_THRESHOLD) {
        activeTouch.moved = true;
        logger.debug('Touch became scroll', { context: activeTouch.context, pointerId: event.pointerId, distance });
    }
}

/**
 * Handle pointerup - determine if gesture qualifies as a tap.
 * @param context Which handler is trying to consume this pointerup
 * Returns { isTap: true, target } if valid tap for this context, { isTap: false } otherwise.
 */
export function handlePointerUp(
    event: PointerEvent,
    context: TouchContext
): { isTap: boolean; target: HTMLElement | null } {
    // Only consume if this context started the tracking
    if (!activeTouch || event.pointerId !== activeTouch.pointerId || activeTouch.context !== context) {
        return { isTap: false, target: null };
    }

    const wasTap = !activeTouch.moved;
    const target = activeTouch.target;

    logger.debug('Touch ended', { context, pointerId: event.pointerId, wasTap });

    // Clear active touch
    activeTouch = null;

    return { isTap: wasTap, target };
}

/**
 * Handle pointercancel - abort touch tracking.
 */
export function handlePointerCancel(event: PointerEvent): void {
    if (activeTouch && event.pointerId === activeTouch.pointerId) {
        logger.debug('Touch cancelled', { context: activeTouch.context, pointerId: event.pointerId });
        activeTouch = null;
    }
}

/**
 * Reset touch state. Call when focus changes or other events
 * that should cancel any in-progress gesture.
 */
export function resetTouchState(): void {
    if (activeTouch) {
        logger.debug('Touch state reset');
        activeTouch = null;
    }
}
