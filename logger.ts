/**
 * Centralized logger with configurable log levels.
 *
 * Provides consistent prefixing for all plugin logs and exposes runtime
 * controls via the browser console for dynamic log level adjustment.
 *
 * modified from: https://github.com/cipherswami/joplin-plugin-quick-note/blob/main/src/logger.ts
 *
 * @usage
 * import logger from './logger';
 *
 * logger.warn('Warning message', { context: 'data' });
 * logger.error('Error occurred', error);
 *
 * // Runtime control via dev console:
 * console.richTables.setLogLevel(0) // DEBUG
 * console.richTables.setLogLevel(1) // INFO
 * console.richTables.setLogLevel(2) // WARN
 * console.richTables.setLogLevel(3) // ERROR
 * console.richTables.setLogLevel(4) // NONE
 * console.richTables.getLogLevel()  // get current log level
 */

const PREFIX = '[Rich Tables]';

/**
 * Log level enumeration.
 * Lower values indicate greater verbosity.
 */
export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    NONE = 4,
}

export class Logger {
    private level: LogLevel;

    constructor(private prefix: string, initialLevel: LogLevel) {
        this.level = initialLevel;
    }

    getLevelName(level: number): string {
        return LogLevel[level] ?? 'UNKNOWN';
    }

    setLevel(level: LogLevel): void {
        // Validate that level is within valid range
        if (typeof level !== 'number' || level < LogLevel.DEBUG || level > LogLevel.NONE) {
            console.error(
                `${this.prefix} Invalid log level: ${level}. Valid range is ${LogLevel.DEBUG}-${LogLevel.NONE}`
            );
            return;
        }
        this.level = level;
        const levelName = this.getLevelName(level);
        console.info(`${this.prefix} Log level set to: ${levelName} (${level})`);
    }

    getLevel(): LogLevel {
        return this.level;
    }

    debug(message: string, ...args: unknown[]): void {
        if (this.level <= LogLevel.DEBUG) {
            console.debug(this.prefix, message, ...args);
        }
    }

    info(message: string, ...args: unknown[]): void {
        if (this.level <= LogLevel.INFO) {
            console.info(this.prefix, message, ...args);
        }
    }

    warn(message: string, ...args: unknown[]): void {
        if (this.level <= LogLevel.WARN) {
            console.warn(this.prefix, message, ...args);
        }
    }

    error(message: string, ...args: unknown[]): void {
        if (this.level <= LogLevel.ERROR) {
            console.error(this.prefix, message, ...args);
        }
    }
}

declare global {
    interface Console {
        richTables?: {
            setLogLevel: (level: LogLevel) => void;
            getLogLevel: () => LogLevel;
        };
    }
}

function createLogger(prefix: string, initialLevel?: LogLevel): Logger {
    const loggerInstance = new Logger(prefix, initialLevel);

    // Attach logger controls to console for runtime debugging
    // Uses console namespace pattern to avoid global pollution
    if (typeof globalThis !== 'undefined') {
        const con = globalThis.console;

        // Always overwrite to ensure we control the *active* logger instance
        // (Fixes issue where reloading plugin leaves stale logger control)
        con.richTables = {
            setLogLevel: (level: LogLevel) => loggerInstance.setLevel(level),
            getLogLevel: () => {
                const level = loggerInstance.getLevel();
                const name = loggerInstance.getLevelName(level);
                console.info(`${prefix} Current log level: ${name} (${level})`);
                return level;
            },
        };
    }

    return loggerInstance;
}

export const logger = createLogger(PREFIX, LogLevel.WARN);
