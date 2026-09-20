// Import order matters: this stub must set `navigator` before the harness pulls in
// `@codemirror/view`, which snapshots the platform at module load and never re-reads it.
// Keep it first; otherwise the harness asserts against whatever platform jsdom reports.
import './historyShortcutPlatformMacos';
import { registerHistoryShortcutTests } from './historyShortcutHarness';

describe('history shortcuts on macOS', () => {
    it('applies the simulated platform navigator', () => {
        expect(navigator.platform).toBe('MacIntel');
    });

    registerHistoryShortcutTests('macOS');
});
