// Import order matters: this stub must set `navigator` before the harness pulls in
// `@codemirror/view`, which snapshots the platform at module load and never re-reads it.
// Keep it first; the platform assertion below does not catch a reordering on its own.
import './historyShortcutPlatformLinux';
import { registerHistoryShortcutTests } from './historyShortcutHarness';

describe('history shortcuts on Linux', () => {
    it('stubs navigator before CodeMirror loads', () => {
        expect(navigator.platform).toBe('Linux x86_64');
    });

    registerHistoryShortcutTests('Linux');
});
