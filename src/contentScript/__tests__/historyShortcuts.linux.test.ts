import './historyShortcutPlatformLinux';
import { registerHistoryShortcutTests } from './historyShortcutHarness';

describe('history shortcuts on Linux', () => {
    it('stubs navigator before CodeMirror loads', () => {
        expect(navigator.platform).toBe('Linux x86_64');
    });

    registerHistoryShortcutTests('Linux');
});
