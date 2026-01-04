/**
 * Navigation lock to prevent race conditions during rapid cell navigation.
 * When a navigation is in progress (dispatching state, mounting nested editor, focusing),
 * subsequent navigation calls are rejected until the current one completes.
 *
 * Safety: A timeout automatically releases the lock after LOCK_TIMEOUT_MS to prevent
 * indefinite lock if the release callback never fires (e.g., view disconnects, error thrown).
 */

import { logger } from '../../logger';

const LOCK_TIMEOUT_MS = 1000;

let navigationLocked = false;
let pendingReleaseCallback: (() => void) | null = null;
let lockTimeoutId: ReturnType<typeof setTimeout> | null = null;

export function isNavigationLocked(): boolean {
    return navigationLocked;
}

export function acquireNavigationLock(): boolean {
    if (navigationLocked) return false;
    navigationLocked = true;

    // Safety timeout: auto-release if normal release never happens
    lockTimeoutId = setTimeout(() => {
        if (navigationLocked) {
            logger.warn('Navigation lock timed out - forcing release');
            releaseNavigationLock();
        }
    }, LOCK_TIMEOUT_MS);

    return true;
}

export function releaseNavigationLock(): void {
    navigationLocked = false;
    pendingReleaseCallback = null;

    if (lockTimeoutId !== null) {
        clearTimeout(lockTimeoutId);
        lockTimeoutId = null;
    }
}

/**
 * Sets a callback to be invoked when navigation completes.
 * Used when the caller can't directly pass onFocused (e.g., row creation path).
 */
export function setPendingNavigationCallback(callback: () => void): void {
    pendingReleaseCallback = callback;
}

/**
 * Gets and clears the pending navigation callback.
 * Called by openNestedCellEditor to invoke the callback after focus.
 */
export function consumePendingNavigationCallback(): (() => void) | null {
    const callback = pendingReleaseCallback;
    pendingReleaseCallback = null;
    return callback;
}

/**
 * Resets the navigation lock state. For testing only.
 */
export function resetNavigationLock(): void {
    navigationLocked = false;
    pendingReleaseCallback = null;

    if (lockTimeoutId !== null) {
        clearTimeout(lockTimeoutId);
        lockTimeoutId = null;
    }
}
