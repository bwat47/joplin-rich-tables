import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type PluginValue } from '@codemirror/view';

/** Picks the elements that should currently carry the class. */
export type ClassSyncCollector = (view: EditorView) => HTMLElement[];

/**
 * Keeps a class in sync with editor state on elements a state field cannot address.
 *
 * Widget DOM lives outside the decoration model, so a class on a widget root or one of its
 * cells has to be written by hand. The write is deferred to CodeMirror's measure phase
 * because the transactions that change the selection can also rebuild the table widget, and
 * `PluginValue.update()` may run before the replacement DOM is mounted — reading the DOM
 * there would find the outgoing elements.
 */
class MeasuredClassSync implements PluginValue {
    private applied = new Set<HTMLElement>();
    private destroyed = false;

    constructor(
        private readonly view: EditorView,
        private readonly className: string,
        private readonly collect: ClassSyncCollector
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
        for (const element of this.applied) {
            element.classList.remove(this.className);
        }
        this.applied.clear();
    }

    /** Applies only the membership differences between the previous and next collections. */
    private sync(elements: HTMLElement[]): void {
        const next = new Set(elements);

        for (const element of this.applied) {
            if (!next.has(element)) {
                element.classList.remove(this.className);
            }
        }

        for (const element of next) {
            if (!this.applied.has(element)) {
                element.classList.add(this.className);
            }
        }

        this.applied = next;
    }

    private scheduleSync(): void {
        this.view.requestMeasure({
            key: this,
            read: () => this.collect(this.view),
            write: (elements: HTMLElement[]) => {
                if (this.destroyed) {
                    return;
                }

                this.sync(elements);
            },
        });
    }
}

/**
 * A view plugin that applies `className` to exactly the elements `collect` returns, refreshing
 * on every view update and mutating only elements whose membership changed.
 */
export function measuredClassSyncPlugin(className: string, collect: ClassSyncCollector): Extension {
    return ViewPlugin.define((view) => new MeasuredClassSync(view, className, collect));
}
