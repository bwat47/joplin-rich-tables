// Import order matters: this stub must set `navigator` before the harness pulls in
// `@codemirror/view`, which snapshots the platform at module load and never re-reads it.
// Keep it first; the harness fails fast when CodeMirror resolved a different platform.
import './keymapPlatformLinux';
import { registerPlatformShortcutTests } from './platformShortcutHarness';

describe('platform shortcuts on Linux', () => {
    registerPlatformShortcutTests('Linux');
});
