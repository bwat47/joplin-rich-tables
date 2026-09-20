import './historyShortcutPlatformMacos';
import { registerHistoryShortcutTests } from './historyShortcutHarness';

describe('history shortcuts on macOS', () => {
    it('stubs navigator before CodeMirror loads', () => {
        expect(navigator.platform).toBe('MacIntel');
    });

    registerHistoryShortcutTests('macOS');
});
