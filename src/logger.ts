/**
 * Logger wrapper for consistent plugin logging
 */

const PREFIX = '[RichTables]';

export const logger = {
    info: (...args: unknown[]) => console.info(PREFIX, ...args),
    warn: (...args: unknown[]) => console.warn(PREFIX, ...args),
    error: (...args: unknown[]) => console.error(PREFIX, ...args),
    debug: (...args: unknown[]) => console.debug(PREFIX, ...args),
};
