import {
    isNavigationLocked,
    acquireNavigationLock,
    releaseNavigationLock,
    setPendingNavigationCallback,
    consumePendingNavigationCallback,
    resetNavigationLock,
} from '../tableWidget/navigationLock';

// Mock the logger to avoid console output during tests
jest.mock('../../logger', () => ({
    logger: {
        warn: jest.fn(),
    },
}));

// Get reference to mock for clearing between tests
import { logger } from '../../logger';
const mockLoggerWarn = logger.warn as jest.Mock;

describe('navigationLock', () => {
    beforeEach(() => {
        // Ensure clean state before each test
        resetNavigationLock();
        mockLoggerWarn.mockClear();
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('basic lock/release', () => {
        it('should start unlocked', () => {
            expect(isNavigationLocked()).toBe(false);
        });

        it('should acquire lock successfully when unlocked', () => {
            expect(acquireNavigationLock()).toBe(true);
            expect(isNavigationLocked()).toBe(true);
        });

        it('should release lock successfully', () => {
            acquireNavigationLock();
            releaseNavigationLock();
            expect(isNavigationLocked()).toBe(false);
        });

        it('should reject lock acquisition when already locked', () => {
            acquireNavigationLock();
            expect(acquireNavigationLock()).toBe(false);
            expect(isNavigationLocked()).toBe(true);
        });

        it('should allow re-acquisition after release', () => {
            acquireNavigationLock();
            releaseNavigationLock();
            expect(acquireNavigationLock()).toBe(true);
        });
    });

    describe('pending callback', () => {
        it('should store and consume pending callback', () => {
            const callback = jest.fn();
            setPendingNavigationCallback(callback);

            const consumed = consumePendingNavigationCallback();
            expect(consumed).toBe(callback);

            // Should be cleared after consumption
            expect(consumePendingNavigationCallback()).toBeNull();
        });

        it('should clear pending callback on release', () => {
            const callback = jest.fn();
            acquireNavigationLock();
            setPendingNavigationCallback(callback);
            releaseNavigationLock();

            expect(consumePendingNavigationCallback()).toBeNull();
        });

        it('should return null when no callback is pending', () => {
            expect(consumePendingNavigationCallback()).toBeNull();
        });
    });

    describe('timeout safety', () => {
        it('should auto-release lock after timeout', () => {
            acquireNavigationLock();
            expect(isNavigationLocked()).toBe(true);

            // Advance time past the timeout (1000ms)
            jest.advanceTimersByTime(1000);

            expect(isNavigationLocked()).toBe(false);
        });

        it('should not auto-release if manually released before timeout', () => {
            acquireNavigationLock();
            releaseNavigationLock();

            // Advance time past the timeout
            jest.advanceTimersByTime(1000);

            // Should still be unlocked (not locked again)
            expect(isNavigationLocked()).toBe(false);
        });

        it('should log warning when timeout forces release', () => {
            acquireNavigationLock();
            jest.advanceTimersByTime(1000);

            expect(mockLoggerWarn).toHaveBeenCalledWith('Navigation lock timed out - forcing release');
        });

        it('should not log warning on normal release', () => {
            acquireNavigationLock();
            releaseNavigationLock();

            // Advance time to ensure timeout would have fired
            jest.advanceTimersByTime(1000);

            expect(mockLoggerWarn).not.toHaveBeenCalled();
        });

        it('should allow new lock acquisition after timeout', () => {
            acquireNavigationLock();
            jest.advanceTimersByTime(1000);

            expect(acquireNavigationLock()).toBe(true);
        });
    });

    describe('resetNavigationLock', () => {
        it('should reset locked state', () => {
            acquireNavigationLock();
            resetNavigationLock();
            expect(isNavigationLocked()).toBe(false);
        });

        it('should clear pending callback', () => {
            setPendingNavigationCallback(jest.fn());
            resetNavigationLock();
            expect(consumePendingNavigationCallback()).toBeNull();
        });

        it('should cancel pending timeout', () => {
            acquireNavigationLock();
            resetNavigationLock();

            // Advance time past the timeout
            jest.advanceTimersByTime(1000);

            // Timeout should not have fired
            expect(mockLoggerWarn).not.toHaveBeenCalled();
        });
    });

    describe('concurrent navigation prevention', () => {
        it('should prevent rapid successive lock acquisitions', () => {
            // Simulate rapid key presses
            const results = [
                acquireNavigationLock(),
                acquireNavigationLock(),
                acquireNavigationLock(),
            ];

            expect(results).toEqual([true, false, false]);
        });

        it('should allow sequential navigation after proper release', () => {
            // First navigation
            expect(acquireNavigationLock()).toBe(true);
            releaseNavigationLock();

            // Second navigation
            expect(acquireNavigationLock()).toBe(true);
            releaseNavigationLock();

            // Third navigation
            expect(acquireNavigationLock()).toBe(true);
        });
    });
});
