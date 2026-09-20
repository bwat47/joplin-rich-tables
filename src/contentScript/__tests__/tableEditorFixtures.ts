import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { vi } from 'vitest';
import type { Extension } from '@codemirror/state';
import type { HostEditorConfig } from '../../contentScriptBridge/hostEditorConfigBridge';
import { hostEditorConfigFacet } from '../services/hostEditorConfig';
import { createMarkdownRenderer, markdownRenderServiceFacet } from '../services/markdownRenderer';
import { nestedEditorPlugin } from '../nestedEditor/nestedEditorController';
import { activeCellField } from '../tableState/activeCellState';
import { cellSelectionField } from '../tableState/cellSelectionState';
import { cellDragField } from '../tableState/cellDragState';
import { tableContextField } from '../tableState/tableContextField';
import { openCellRequestField } from '../tableRuntime/openCellRequest';
import { nestedEditorLifecyclePlugin } from '../tableRuntime/lifecycle/nestedEditorLifecycle';
import { cellSelectionFocusPlugin } from '../tableRuntime/selection/cellSelectionController';
import { cellSelectionKeyCapturePlugin } from '../tableRuntime/selection/cellSelectionKeymap';
import { tableDecorationField } from '../tableWidget/tableDecorationField';

/** Nested-editor settings a test can assert against when it does not set its own. */
export const TEST_NESTED_EDITOR_SETTINGS = {
    autoMatchingBraces: true,
    spellcheck: false,
} satisfies HostEditorConfig['nestedEditor'];

/** Host settings for tests that do not exercise a particular toggle. */
export const TEST_HOST_CONFIG = {
    nestedEditor: TEST_NESTED_EDITOR_SETTINGS,
    tableAppearance: {
        zebraStriping: false,
    },
    toolbar: {
        showMoveButtons: true,
        showClearButtons: true,
        showAlignmentButtons: true,
        showDeleteTableButton: true,
        showSortButtons: true,
    },
} satisfies HostEditorConfig;

export interface ResizeObserverStub {
    /** Stubs `ResizeObserver`, dropping the observers of a previous install. Call from `beforeEach`. */
    install(): void;
    /** Fires every observer created since `install`, as a real resize would. */
    trigger(): void;
}

/**
 * jsdom implements no `ResizeObserver`, and `TableWidget` observes its own DOM for height
 * changes, so mounting one throws without this.
 */
export function createResizeObserverStub(): ResizeObserverStub {
    let callbacks: Array<() => void> = [];

    class ResizeObserverMock {
        constructor(callback: () => void) {
            callbacks.push(callback);
        }
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
    }

    return {
        install(): void {
            callbacks = [];
            vi.stubGlobal('ResizeObserver', ResizeObserverMock as unknown as typeof ResizeObserver);
        },
        trigger(): void {
            for (const callback of callbacks) {
                callback();
            }
        },
    };
}

/**
 * jsdom implements no layout, so CodeMirror's measuring throws without these. Call once at
 * module scope; both guards are no-ops when a richer stub is already installed.
 */
export function installRangeLayoutStubs(): void {
    if (!Range.prototype.getBoundingClientRect) {
        Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
            value: () => ({
                x: 0,
                y: 0,
                width: 0,
                height: 0,
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
                toJSON: () => ({}),
            }),
        });
    }

    if (!Range.prototype.getClientRects) {
        Object.defineProperty(Range.prototype, 'getClientRects', {
            value: () => [],
        });
    }
}

export interface FrameQueue {
    /** Stubs `ResizeObserver` and `requestAnimationFrame`. Call from `beforeEach`. */
    install(): void;
    /**
     * Drains the frame queue, letting queued microtasks run between frames so work the
     * lifecycle schedules as a microtask (opening a requested cell) settles too.
     */
    flush(): Promise<void>;
}

export function createFrameQueue(): FrameQueue {
    let queue: FrameRequestCallback[] = [];
    const resizeObserver = createResizeObserverStub();

    return {
        install(): void {
            queue = [];
            resizeObserver.install();
            vi.stubGlobal('requestAnimationFrame', ((callback: FrameRequestCallback) => {
                queue.push(callback);
                return queue.length;
            }) as typeof requestAnimationFrame);
        },
        async flush(): Promise<void> {
            await Promise.resolve();
            while (queue.length > 0) {
                const callback = queue.shift();
                callback?.(0);
                await Promise.resolve();
            }
        },
    };
}

/**
 * A main editor that renders table widgets and opens nested cell editors. Callers add
 * `history()` when the test drives undo/redo.
 */
export function nestedEditorTestExtensions(...extra: Extension[]): Extension[] {
    return [
        markdown({ extensions: [GFM] }),
        hostEditorConfigFacet.of(TEST_HOST_CONFIG),
        markdownRenderServiceFacet.of(createMarkdownRenderer(async (markup, id) => ({ id, html: markup }))),
        nestedEditorPlugin,
        tableContextField,
        activeCellField,
        openCellRequestField,
        nestedEditorLifecyclePlugin,
        tableDecorationField,
        ...extra,
    ];
}

/** A main editor that owns a cell selection, without the nested-editor lifecycle. */
export function cellSelectionTestExtensions(...extra: Extension[]): Extension[] {
    return [
        markdown({ extensions: [GFM] }),
        tableContextField,
        activeCellField,
        cellSelectionField,
        cellDragField,
        cellSelectionKeyCapturePlugin,
        cellSelectionFocusPlugin,
        ...extra,
    ];
}
