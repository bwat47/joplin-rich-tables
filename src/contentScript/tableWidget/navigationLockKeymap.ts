/**
 * Main editor keymap guard that intercepts Tab/Enter when navigation lock is held.
 *
 * During row creation, there's a gap between closing the old nested editor and
 * opening the new one (due to RAF for DOM mount). During this gap, Tab/Enter
 * keypresses can leak to the main editor if not intercepted here.
 */

import { keymap } from '@codemirror/view';
import { isNavigationLocked } from './navigationLock';

export const navigationLockKeymap = keymap.of([
    {
        key: 'Tab',
        run: () => {
            if (isNavigationLocked()) {
                return true; // Consume the event
            }
            return false;
        },
    },
    {
        key: 'Shift-Tab',
        run: () => {
            if (isNavigationLocked()) {
                return true;
            }
            return false;
        },
    },
    {
        key: 'Enter',
        run: () => {
            if (isNavigationLocked()) {
                return true;
            }
            return false;
        },
    },
]);
