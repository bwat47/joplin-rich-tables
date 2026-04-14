import { describe, expect, it, jest } from '@jest/globals';
import type { EditorView } from '@codemirror/view';
import { getDocumentWindow, requestViewAnimationFrame } from '../shared/domContext';

describe('domContext', () => {
    it('prefers the document defaultView over the ambient window', () => {
        const callback = jest.fn();
        const rafSpy = jest.fn((frameCallback: FrameRequestCallback) => {
            void frameCallback;
            return 42;
        });
        const fakeWindow = { requestAnimationFrame: rafSpy } as unknown as Window;
        const fakeDocument = { defaultView: fakeWindow } as Document;
        const fakeView = {
            dom: {
                ownerDocument: fakeDocument,
            },
        } as EditorView;

        expect(getDocumentWindow(fakeDocument)).toBe(fakeWindow);
        expect(requestViewAnimationFrame(fakeView, callback)).toBe(42);
        expect(rafSpy).toHaveBeenCalledTimes(1);
        expect(rafSpy.mock.calls[0]).toEqual([callback]);
    });
});
