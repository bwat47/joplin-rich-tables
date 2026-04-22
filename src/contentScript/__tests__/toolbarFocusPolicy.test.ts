import { describe, expect, it } from '@jest/globals';
import { shouldToolbarActionFocusMainEditor } from '../toolbar/toolbarFocusPolicy';

describe('toolbarFocusPolicy', () => {
    it('skips generic main-editor focus for row-insert toolbar actions', () => {
        expect(shouldToolbarActionFocusMainEditor('insertRowBefore')).toBe(false);
        expect(shouldToolbarActionFocusMainEditor('insertRowAfter')).toBe(false);
    });

    it('keeps generic main-editor focus for non-row toolbar actions', () => {
        expect(shouldToolbarActionFocusMainEditor('deleteRow')).toBe(true);
        expect(shouldToolbarActionFocusMainEditor('insertColumnBefore')).toBe(true);
        expect(shouldToolbarActionFocusMainEditor('clearTable')).toBe(true);
    });
});
