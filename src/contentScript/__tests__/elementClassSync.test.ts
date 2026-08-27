/**
 * @vitest-environment jsdom
 */

import { StateEffect, StateField } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { createElementClassSyncPlugin } from '../tableWidget/elementClassSync';

const MARKED = 'test-marked';

// The collector reads from state so a dispatch drives it, the way the real collectors
// derive their elements from the selection.
const setTargetsEffect = StateEffect.define<string[]>();
const targetsField = StateField.define<string[]>({
    create: () => [],
    update(value, transaction) {
        for (const effect of transaction.effects) {
            if (effect.is(setTargetsEffect)) {
                return effect.value;
            }
        }
        return value;
    },
});

const mountedViews: EditorView[] = [];

function mountView(): { view: EditorView; targets: Record<string, HTMLElement> } {
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    // Elements the plugin can mark, kept outside the editor content so CodeMirror's own
    // DOM updates never replace them mid-test.
    const targets: Record<string, HTMLElement> = {};
    for (const id of ['a', 'b']) {
        const element = document.createElement('div');
        element.id = id;
        parent.appendChild(element);
        targets[id] = element;
    }

    const view = new EditorView({
        parent,
        doc: 'doc',
        extensions: [
            targetsField,
            createElementClassSyncPlugin(MARKED, (v) => v.state.field(targetsField).map((id) => targets[id])),
        ],
    });
    mountedViews.push(view);

    return { view, targets };
}

/** Runs the measure cycle the class sync defers its DOM work to. */
function flushMeasure(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function setTargets(view: EditorView, ids: string[]): Promise<void> {
    view.dispatch({ effects: setTargetsEffect.of(ids) });
    await flushMeasure();
}

afterEach(() => {
    while (mountedViews.length > 0) {
        mountedViews.pop()?.destroy();
    }
    document.body.replaceChildren();
});

describe('createElementClassSyncPlugin', () => {
    it('marks the collected elements', async () => {
        const { view, targets } = mountView();

        await setTargets(view, ['a', 'b']);

        expect(targets.a.classList.contains(MARKED)).toBe(true);
        expect(targets.b.classList.contains(MARKED)).toBe(true);
    });

    it('unmarks elements the collector stops returning', async () => {
        const { view, targets } = mountView();
        await setTargets(view, ['a', 'b']);

        await setTargets(view, ['b']);

        expect(targets.a.classList.contains(MARKED)).toBe(false);
        expect(targets.b.classList.contains(MARKED)).toBe(true);
    });

    it('clears every mark when the collector returns nothing', async () => {
        const { view, targets } = mountView();
        await setTargets(view, ['a', 'b']);

        await setTargets(view, []);

        expect(targets.a.classList.contains(MARKED)).toBe(false);
        expect(targets.b.classList.contains(MARKED)).toBe(false);
    });

    it('leaves a class it did not add alone', async () => {
        const { view, targets } = mountView();
        targets.a.classList.add(MARKED);

        // 'a' is never collected, so the sync must not take ownership of its class.
        await setTargets(view, ['b']);

        expect(targets.a.classList.contains(MARKED)).toBe(true);
    });

    it('clears its marks when the view is destroyed', async () => {
        const { view, targets } = mountView();
        await setTargets(view, ['a', 'b']);

        view.destroy();

        expect(targets.a.classList.contains(MARKED)).toBe(false);
        expect(targets.b.classList.contains(MARKED)).toBe(false);
    });
});
