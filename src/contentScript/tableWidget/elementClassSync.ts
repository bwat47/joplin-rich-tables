import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type PluginValue } from '@codemirror/view';

/**
 * Keeps a CSS class in sync with the set of elements a collector derives from editor state.
 *
 * Selection rewrites can rebuild a table widget, and `ViewPlugin.update()` may run before the
 * replacement DOM is mounted, so both the collect and the class write happen in the measure
 * phase, against the DOM that is actually on screen.
 */
class ElementClassSync implements PluginValue {
    private marked = new Set<HTMLElement>();
    private destroyed = false;

    constructor(
        private readonly view: EditorView,
        private readonly className: string,
        private readonly collect: (view: EditorView) => HTMLElement[]
    ) {
        this.scheduleSync();
    }

    update(): void {
        this.scheduleSync();
    }

    destroy(): void {
        this.destroyed = true;
        this.clear();
    }

    private clear(): void {
        for (const element of this.marked) {
            element.classList.remove(this.className);
        }
        this.marked.clear();
    }

    private scheduleSync(): void {
        this.view.requestMeasure({
            key: this,
            read: () => this.collect(this.view),
            write: (elements: HTMLElement[]) => {
                if (this.destroyed) {
                    return;
                }

                this.clear();

                for (const element of elements) {
                    element.classList.add(this.className);
                    this.marked.add(element);
                }
            },
        });
    }
}

/**
 * Builds a view plugin that owns `className` on whatever elements `collect` returns.
 *
 * Each plugin instance only ever removes the class from elements it added it to, so two
 * syncs must not share a class name.
 */
export function createElementClassSyncPlugin(
    className: string,
    collect: (view: EditorView) => HTMLElement[]
): Extension {
    return ViewPlugin.define((view) => new ElementClassSync(view, className, collect));
}
