/** @vitest-environment jsdom */

import { StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { measuredClassSyncPlugin } from '../tableWidget/measuredClassSync';

const CLASS_NAME = 'tracked';
const refreshEffect = StateEffect.define<void>();
const mountedViews: EditorView[] = [];

/** Resolves after every measure already queued on the view has written its DOM changes. */
function flushMeasure(view: EditorView): Promise<void> {
    return new Promise((resolve) => {
        view.requestMeasure({
            read: () => undefined,
            write: () => resolve(),
        });
    });
}

interface MutationTracker {
    disconnect: () => void;
    takeCount: () => number;
}

function observeClassMutations(element: HTMLElement): MutationTracker {
    let deliveredCount = 0;
    const observer = new MutationObserver((records) => {
        deliveredCount += records.length;
    });
    observer.observe(element, { attributes: true, attributeFilter: ['class'] });

    return {
        disconnect: () => observer.disconnect(),
        takeCount: () => {
            const count = deliveredCount + observer.takeRecords().length;
            deliveredCount = 0;
            return count;
        },
    };
}

afterEach(() => {
    while (mountedViews.length > 0) {
        mountedViews.pop()?.destroy();
    }
    document.body.replaceChildren();
});

describe('measuredClassSyncPlugin', () => {
    it('mutates classes only for elements whose collected membership changed', async () => {
        const parent = document.createElement('div');
        const retained = document.createElement('div');
        const removed = document.createElement('div');
        const added = document.createElement('div');
        document.body.append(parent, retained, removed, added);

        let collected = [retained, removed];
        const view = new EditorView({
            parent,
            extensions: [measuredClassSyncPlugin(CLASS_NAME, () => collected)],
        });
        mountedViews.push(view);
        await flushMeasure(view);

        expect(retained.classList.contains(CLASS_NAME)).toBe(true);
        expect(removed.classList.contains(CLASS_NAME)).toBe(true);
        expect(added.classList.contains(CLASS_NAME)).toBe(false);

        const retainedObserver = observeClassMutations(retained);
        const removedObserver = observeClassMutations(removed);
        const addedObserver = observeClassMutations(added);

        collected = [retained, added];
        view.dispatch({ effects: refreshEffect.of(undefined) });
        await flushMeasure(view);

        expect(retainedObserver.takeCount()).toBe(0);
        expect(removedObserver.takeCount()).toBe(1);
        expect(addedObserver.takeCount()).toBe(1);
        expect(retained.classList.contains(CLASS_NAME)).toBe(true);
        expect(removed.classList.contains(CLASS_NAME)).toBe(false);
        expect(added.classList.contains(CLASS_NAME)).toBe(true);

        view.dispatch({ effects: refreshEffect.of(undefined) });
        await flushMeasure(view);

        expect(retainedObserver.takeCount()).toBe(0);
        expect(removedObserver.takeCount()).toBe(0);
        expect(addedObserver.takeCount()).toBe(0);
        expect(retained.classList.contains(CLASS_NAME)).toBe(true);
        expect(removed.classList.contains(CLASS_NAME)).toBe(false);
        expect(added.classList.contains(CLASS_NAME)).toBe(true);

        retainedObserver.disconnect();
        removedObserver.disconnect();
        addedObserver.disconnect();
    });

    it('removes the class from the elements it marked when the view is destroyed', async () => {
        const parent = document.createElement('div');
        const marked = document.createElement('div');
        document.body.append(parent, marked);

        const view = new EditorView({
            parent,
            extensions: [measuredClassSyncPlugin(CLASS_NAME, () => [marked])],
        });
        mountedViews.push(view);
        await flushMeasure(view);

        expect(marked.classList.contains(CLASS_NAME)).toBe(true);

        mountedViews.pop()?.destroy();

        expect(marked.classList.contains(CLASS_NAME)).toBe(false);
    });
});
