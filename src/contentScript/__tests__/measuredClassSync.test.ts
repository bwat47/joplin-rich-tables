import { StateEffect } from '@codemirror/state';
import { afterEach, describe, expect, it } from 'vitest';

import { measuredClassSyncPlugin } from '../tableWidget/measuredClassSync';
import { createEditorViewHarness, flushViewMeasure } from './tableEditorFixtures';

const CLASS_NAME = 'tracked';
const refreshEffect = StateEffect.define<void>();
const viewHarness = createEditorViewHarness();

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
    viewHarness.destroyViews();
    // The tracked elements sit beside the editor, directly in the document.
    document.body.replaceChildren();
});

describe('measuredClassSyncPlugin', () => {
    it('mutates classes only for elements whose collected membership changed', async () => {
        const retained = document.createElement('div');
        const removed = document.createElement('div');
        const added = document.createElement('div');
        document.body.append(retained, removed, added);

        let collected = [retained, removed];
        const view = viewHarness.mountView({
            extensions: [measuredClassSyncPlugin(CLASS_NAME, () => collected)],
        });
        await flushViewMeasure(view);

        expect(retained.classList.contains(CLASS_NAME)).toBe(true);
        expect(removed.classList.contains(CLASS_NAME)).toBe(true);
        expect(added.classList.contains(CLASS_NAME)).toBe(false);

        const retainedObserver = observeClassMutations(retained);
        const removedObserver = observeClassMutations(removed);
        const addedObserver = observeClassMutations(added);

        collected = [retained, added];
        view.dispatch({ effects: refreshEffect.of(undefined) });
        await flushViewMeasure(view);

        expect(retainedObserver.takeCount()).toBe(0);
        expect(removedObserver.takeCount()).toBe(1);
        expect(addedObserver.takeCount()).toBe(1);
        expect(retained.classList.contains(CLASS_NAME)).toBe(true);
        expect(removed.classList.contains(CLASS_NAME)).toBe(false);
        expect(added.classList.contains(CLASS_NAME)).toBe(true);

        view.dispatch({ effects: refreshEffect.of(undefined) });
        await flushViewMeasure(view);

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
        const marked = document.createElement('div');
        document.body.append(marked);

        const view = viewHarness.mountView({
            extensions: [measuredClassSyncPlugin(CLASS_NAME, () => [marked])],
        });
        await flushViewMeasure(view);

        expect(marked.classList.contains(CLASS_NAME)).toBe(true);

        viewHarness.destroyViews();

        expect(marked.classList.contains(CLASS_NAME)).toBe(false);
    });
});
