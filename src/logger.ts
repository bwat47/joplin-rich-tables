/**
 * Centralized logger with optional debug toggle.
 *
 * Provides consistent prefixing for all plugin logs and exposes a simple
 * `setDebug` method to enable verbose output.
 */

const PREFIX = '[Rich Tables]';

let debugEnabled = false;

export const logger = {
    setDebug(enabled: boolean): void {
        debugEnabled = enabled;
    },

    debug(message: string, ...args: unknown[]): void {
        if (!debugEnabled) return;
        console.debug(PREFIX, message, ...args);
    },

    info(message: string, ...args: unknown[]): void {
        console.info(PREFIX, message, ...args);
    },

    warn(message: string, ...args: unknown[]): void {
        console.warn(PREFIX, message, ...args);
    },

    error(message: string, ...args: unknown[]): void {
        console.error(PREFIX, message, ...args);
    },
};
