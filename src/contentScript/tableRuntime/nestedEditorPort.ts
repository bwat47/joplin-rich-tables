import { Facet } from '@codemirror/state';
import type { EditorView, ViewUpdate } from '@codemirror/view';
import type { NestedEditorHostConfig } from '../../contentScriptBridge/hostEditorConfigBridge';
import type { InitialCursorPos } from '../shared/cursorPlacement';
import type { CellContentRange, ResolvedActiveCell } from './activeCell/resolvedActiveCell';

export interface OpenNestedEditorParams {
    mainView: EditorView;
    cellElement: HTMLElement;
    /** The active cell, already resolved against the main editor's current state by the caller. */
    resolvedCell: ResolvedActiveCell;
    featureSettings: NestedEditorHostConfig;
    initialCursorPos?: InitialCursorPos;
}

/**
 * How runtime and widget code drive the nested cell editor without importing it.
 *
 * The nested editor sits above the runtime and widget layers and provides this port through
 * `nestedEditorPortFacet`; lower layers only read the facet.
 */
export interface NestedEditorPort {
    isOpen(view: EditorView): boolean;
    isFocused(view: EditorView): boolean;
    /** Mounts a nested editor for `params.resolvedCell`; false when no nested editor is available. */
    open(params: OpenNestedEditorParams): boolean;
    close(view: EditorView, range?: CellContentRange): void;
    handleMainEditorUpdate(view: EditorView, update: ViewUpdate, resolvedCell: ResolvedActiveCell): void;
    refocus(view: EditorView): void;
    /** Flushes the nested editor's current text and selection before an external interaction takes ownership. */
    flush(view: EditorView): void;
    /** Closes the nested editor if it is mounted inside `container`. */
    closeIfHostedIn(view: EditorView, container: HTMLElement): void;
}

/** Used when no nested editor is installed: it is never open and every action is a no-op. */
const absentNestedEditorPort: NestedEditorPort = {
    isOpen: () => false,
    isFocused: () => false,
    open: () => false,
    close: () => {},
    handleMainEditorUpdate: () => {},
    refocus: () => {},
    flush: () => {},
    closeIfHostedIn: () => {},
};

export const nestedEditorPortFacet = Facet.define<NestedEditorPort, NestedEditorPort>({
    combine: (values) => values[0] ?? absentNestedEditorPort,
});

/** The nested editor port bound to one main editor view, so callers don't pass the view to every call. */
export interface NestedEditorHandle {
    isOpen(): boolean;
    isFocused(): boolean;
    /** Mounts a nested editor for `params.resolvedCell`; false when no nested editor is available. */
    open(params: Omit<OpenNestedEditorParams, 'mainView'>): boolean;
    close(range?: CellContentRange): void;
    handleMainEditorUpdate(update: ViewUpdate, resolvedCell: ResolvedActiveCell): void;
    refocus(): void;
    /** Flushes the nested editor's current text and selection before an external interaction takes ownership. */
    flush(): void;
    /** Closes the nested editor if it is mounted inside `container`. */
    closeIfHostedIn(container: HTMLElement): void;
}

class BoundNestedEditor implements NestedEditorHandle {
    constructor(
        private readonly view: EditorView,
        private readonly port: NestedEditorPort
    ) {}

    isOpen(): boolean {
        return this.port.isOpen(this.view);
    }

    isFocused(): boolean {
        return this.port.isFocused(this.view);
    }

    open(params: Omit<OpenNestedEditorParams, 'mainView'>): boolean {
        return this.port.open({ ...params, mainView: this.view });
    }

    close(range?: CellContentRange): void {
        this.port.close(this.view, range);
    }

    handleMainEditorUpdate(update: ViewUpdate, resolvedCell: ResolvedActiveCell): void {
        this.port.handleMainEditorUpdate(this.view, update, resolvedCell);
    }

    refocus(): void {
        this.port.refocus(this.view);
    }

    flush(): void {
        this.port.flush(this.view);
    }

    closeIfHostedIn(container: HTMLElement): void {
        this.port.closeIfHostedIn(this.view, container);
    }
}

/** The nested editor installed on `view`, or a never-open no-op handle when none is installed. */
export function getNestedEditor(view: EditorView): NestedEditorHandle {
    return new BoundNestedEditor(view, view.state.facet(nestedEditorPortFacet));
}
