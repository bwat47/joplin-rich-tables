import './historyShortcutPlatformWindows';
import { registerHistoryShortcutTests } from './historyShortcutHarness';

describe('history shortcuts on Windows', () => {
    it('stubs navigator before CodeMirror loads', () => {
        expect(navigator.platform).toBe('Win32');
    });

    registerHistoryShortcutTests('Windows', { includeLifecycle: true });
});
