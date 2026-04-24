import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { logger } from '../../logger';
import { moveCursorOutOfTable } from './navigation/cursorUtils';

export function createStartupCursorCorrection(getView: () => EditorView): Extension {
    return ViewPlugin.fromClass(
        class {
            constructor() {
                // Move cursor out of table on initial load.
                // On mobile, the content script loads fresh per note, so this handles note switching.
                // On desktop, this handles cold launch when Joplin restores cursor position inside a table.
                setTimeout(() => {
                    const moved = moveCursorOutOfTable(getView());
                    if (moved) {
                        logger.debug('Moved cursor out of table on content script init');
                    }
                }, 0);
            }
        }
    );
}
