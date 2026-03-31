/**
 * @jest-environment jsdom
 */

import { beforeEach, afterEach, describe, expect, it, jest } from '@jest/globals';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { closeNestedEditor, nestedEditorPlugin, openNestedEditor } from '../nestedEditor/nestedEditorController';
import { documentDefinitionsField } from '../services/documentDefinitions';
import type { ActiveCell } from '../tableState/activeCellState';
import type { NestedEditorFeatureSettings } from '../../contentScriptBridge/editorSettingsBridge';
import { CLASS_TABLE_WIDGET } from '../tableWidget/domHelpers';

jest.mock('../nestedEditor/decorationPlugins', () => ({
    inlineCodePlugin: [],
    insertPlugin: [],
    markPlugin: [],
}));

jest.mock('../nestedEditor/domHandlers', () => ({
    createNestedEditorDomHandlers: jest.fn(() => []),
    createNestedEditorKeymap: jest.fn(() => []),
    mirrorLocalSelectionToMain: jest.fn(),
}));

jest.mock('../nestedEditor/joplinHighlightStyle', () => ({
    createJoplinSyntaxHighlighting: jest.fn(() => []),
}));

jest.mock('../nestedEditor/nestedEditorMarkdown', () => ({
    createNestedEditorMarkdownExtension: jest.fn(() => []),
}));

jest.mock('../nestedEditor/nestedEditorTheme', () => ({
    createNestedEditorTheme: jest.fn(() => []),
}));

jest.mock('../nestedEditor/nestedEditorFeatureConfig', () => ({
    createNestedEditorFeatureExtensions: jest.fn(() => []),
}));

const DOC = ['| H1 | H2 |', '| --- | --- |', '| a | b |'].join('\n');
const ACTIVE_CELL: ActiveCell = {
    tableFrom: 0,
    section: 'body',
    row: 0,
    col: 0,
};
const DEFAULT_FEATURE_SETTINGS = {
    autoMatchingBraces: true,
} satisfies NestedEditorFeatureSettings;

interface MockVisualViewport {
    height: number;
    width: number;
    addEventListener: jest.Mock;
    removeEventListener: jest.Mock;
    dispatchEventType: (type: 'resize' | 'scroll') => void;
}

function createRect(top: number, bottom: number, left = 0, right = 100): DOMRect {
    return {
        x: left,
        y: top,
        top,
        bottom,
        left,
        right,
        width: right - left,
        height: bottom - top,
        toJSON: () => '',
    } as DOMRect;
}

function createMockVisualViewport(height: number, width = 400): MockVisualViewport {
    const listeners = new Map<'resize' | 'scroll', Set<EventListener>>();

    const addEventListener = jest.fn((type: 'resize' | 'scroll', listener: EventListener) => {
        const existing = listeners.get(type) ?? new Set<EventListener>();
        existing.add(listener);
        listeners.set(type, existing);
    });

    const removeEventListener = jest.fn((type: 'resize' | 'scroll', listener: EventListener) => {
        listeners.get(type)?.delete(listener);
    });

    return {
        height,
        width,
        addEventListener,
        removeEventListener,
        dispatchEventType: (type) => {
            for (const listener of listeners.get(type) ?? []) {
                listener(new Event(type));
            }
        },
    };
}

function flushNextAnimationFrame(queue: FrameRequestCallback[]): void {
    const callback = queue.shift();
    callback?.(0);
}

function flushAllAnimationFrames(queue: FrameRequestCallback[]): void {
    while (queue.length > 0) {
        flushNextAnimationFrame(queue);
    }
}

function createMainView(params: {
    scrollHeight: number;
    clientHeight: number;
    cellRect: DOMRect;
    scrollDOMRect?: DOMRect;
    widgetRect?: DOMRect;
}) {
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const view = new EditorView({
        parent,
        state: EditorState.create({
            doc: DOC,
            extensions: [markdown({ extensions: [GFM] }), documentDefinitionsField, nestedEditorPlugin],
        }),
    });

    Object.defineProperty(view.scrollDOM, 'scrollHeight', {
        configurable: true,
        get: () => params.scrollHeight,
    });
    Object.defineProperty(view.scrollDOM, 'clientHeight', {
        configurable: true,
        get: () => params.clientHeight,
    });

    const scrollDOMRect = params.scrollDOMRect ?? createRect(0, params.clientHeight);
    jest.spyOn(view.scrollDOM, 'getBoundingClientRect').mockImplementation(() => scrollDOMRect);

    const requestMeasureSpy = jest.spyOn(view, 'requestMeasure').mockImplementation((request) => {
        if (!request) {
            return;
        }

        const measurement = request.read(view);
        request.write?.(measurement, view);
    });

    const widgetElement = document.createElement('div');
    widgetElement.className = CLASS_TABLE_WIDGET;
    document.body.appendChild(widgetElement);
    jest.spyOn(widgetElement, 'getBoundingClientRect').mockImplementation(() => params.widgetRect ?? createRect(0, 100, 0, 300));

    const cellElement = document.createElement('td');
    widgetElement.appendChild(cellElement);
    jest.spyOn(cellElement, 'getBoundingClientRect').mockImplementation(() => params.cellRect);
    Object.defineProperty(cellElement, 'scrollIntoView', {
        configurable: true,
        value: jest.fn(),
    });
    const scrollIntoViewSpy = jest.spyOn(cellElement, 'scrollIntoView').mockImplementation(() => undefined);

    return { view, cellElement, scrollIntoViewSpy, requestMeasureSpy };
}

describe('nestedEditorController deferred reveal', () => {
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalVisualViewport = window.visualViewport;
    const originalInnerHeight = window.innerHeight;
    const originalRangeGetClientRects = Range.prototype.getClientRects;
    const originalRangeGetBoundingClientRect = Range.prototype.getBoundingClientRect;
    let animationFrameQueue: FrameRequestCallback[] = [];
    let focusSpy: jest.SpiedFunction<typeof HTMLElement.prototype.focus>;

    beforeEach(() => {
        jest.useFakeTimers();
        animationFrameQueue = [];
        global.requestAnimationFrame = ((callback: FrameRequestCallback) => {
            animationFrameQueue.push(callback);
            return animationFrameQueue.length;
        }) as typeof requestAnimationFrame;
        focusSpy = jest.spyOn(HTMLElement.prototype, 'focus').mockImplementation(() => undefined);
        Object.defineProperty(window, 'innerHeight', {
            configurable: true,
            value: 800,
        });
        Object.defineProperty(window, 'visualViewport', {
            configurable: true,
            value: undefined,
        });
        Range.prototype.getClientRects = () =>
            ({
                0: createRect(0, 0),
                length: 1,
                item: () => createRect(0, 0),
            }) as unknown as DOMRectList;
        Range.prototype.getBoundingClientRect = () => createRect(0, 0);
    });

    afterEach(() => {
        focusSpy.mockRestore();
        global.requestAnimationFrame = originalRequestAnimationFrame;
        Object.defineProperty(window, 'visualViewport', {
            configurable: true,
            value: originalVisualViewport,
        });
        Object.defineProperty(window, 'innerHeight', {
            configurable: true,
            value: originalInnerHeight,
        });
        Range.prototype.getClientRects = originalRangeGetClientRects;
        Range.prototype.getBoundingClientRect = originalRangeGetBoundingClientRect;
        jest.useRealTimers();
        document.body.innerHTML = '';
    });

    it('focuses the nested editor before any deferred reveal scroll runs', () => {
        const visualViewport = createMockVisualViewport(240);
        Object.defineProperty(window, 'visualViewport', {
            configurable: true,
            value: visualViewport,
        });

        const { view, cellElement, scrollIntoViewSpy } = createMainView({
            scrollHeight: 300,
            clientHeight: 300,
            cellRect: createRect(260, 300),
        });

        openNestedEditor({
            mainView: view,
            cellElement,
            activeCell: ACTIVE_CELL,
            featureSettings: DEFAULT_FEATURE_SETTINGS,
        });

        expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
        expect(scrollIntoViewSpy).not.toHaveBeenCalled();

        view.destroy();
    });

    it('waits for viewport events to settle before scrolling in external-scroll mode', () => {
        const visualViewport = createMockVisualViewport(240);
        Object.defineProperty(window, 'visualViewport', {
            configurable: true,
            value: visualViewport,
        });

        const { view, cellElement, scrollIntoViewSpy } = createMainView({
            scrollHeight: 300,
            clientHeight: 300,
            cellRect: createRect(260, 300),
        });

        openNestedEditor({
            mainView: view,
            cellElement,
            activeCell: ACTIVE_CELL,
            featureSettings: DEFAULT_FEATURE_SETTINGS,
        });
        flushAllAnimationFrames(animationFrameQueue);

        visualViewport.dispatchEventType('resize');
        jest.advanceTimersByTime(99);
        expect(scrollIntoViewSpy).not.toHaveBeenCalled();

        jest.advanceTimersByTime(1);
        expect(scrollIntoViewSpy).not.toHaveBeenCalled();

        flushNextAnimationFrame(animationFrameQueue);
        expect(scrollIntoViewSpy).not.toHaveBeenCalled();

        flushAllAnimationFrames(animationFrameQueue);
        expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);

        view.destroy();
    });

    it('falls back after 150ms when no viewport event fires', () => {
        const visualViewport = createMockVisualViewport(240);
        Object.defineProperty(window, 'visualViewport', {
            configurable: true,
            value: visualViewport,
        });

        const { view, cellElement, scrollIntoViewSpy } = createMainView({
            scrollHeight: 300,
            clientHeight: 300,
            cellRect: createRect(260, 300),
        });

        openNestedEditor({
            mainView: view,
            cellElement,
            activeCell: ACTIVE_CELL,
            featureSettings: DEFAULT_FEATURE_SETTINGS,
        });
        flushAllAnimationFrames(animationFrameQueue);

        jest.advanceTimersByTime(149);
        expect(scrollIntoViewSpy).not.toHaveBeenCalled();

        jest.advanceTimersByTime(1);
        expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);

        view.destroy();
    });

    it('uses the current visual viewport for the no-event fallback when the IME is already open', () => {
        const visualViewport = createMockVisualViewport(260);
        Object.defineProperty(window, 'visualViewport', {
            configurable: true,
            value: visualViewport,
        });

        const { view, cellElement, scrollIntoViewSpy } = createMainView({
            scrollHeight: 300,
            clientHeight: 300,
            cellRect: createRect(220, 250),
        });

        openNestedEditor({
            mainView: view,
            cellElement,
            activeCell: ACTIVE_CELL,
            featureSettings: DEFAULT_FEATURE_SETTINGS,
        });
        flushAllAnimationFrames(animationFrameQueue);

        jest.advanceTimersByTime(150);
        expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);

        view.destroy();
    });

    it('scrolls when the cell is horizontally clipped within the table widget', () => {
        const visualViewport = createMockVisualViewport(260);
        Object.defineProperty(window, 'visualViewport', {
            configurable: true,
            value: visualViewport,
        });

        const { view, cellElement, scrollIntoViewSpy } = createMainView({
            scrollHeight: 300,
            clientHeight: 300,
            widgetRect: createRect(0, 100, 0, 120),
            cellRect: createRect(40, 70, 180, 260),
        });

        openNestedEditor({
            mainView: view,
            cellElement,
            activeCell: ACTIVE_CELL,
            featureSettings: DEFAULT_FEATURE_SETTINGS,
        });
        flushAllAnimationFrames(animationFrameQueue);

        jest.advanceTimersByTime(150);
        expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);

        view.destroy();
    });

    it('does not scroll when the cell is already safely visible', () => {
        const visualViewport = createMockVisualViewport(260);
        Object.defineProperty(window, 'visualViewport', {
            configurable: true,
            value: visualViewport,
        });

        const { view, cellElement, scrollIntoViewSpy } = createMainView({
            scrollHeight: 300,
            clientHeight: 300,
            cellRect: createRect(40, 70, 20, 80),
        });

        openNestedEditor({
            mainView: view,
            cellElement,
            activeCell: ACTIVE_CELL,
            featureSettings: DEFAULT_FEATURE_SETTINGS,
        });
        flushAllAnimationFrames(animationFrameQueue);

        visualViewport.dispatchEventType('resize');
        jest.advanceTimersByTime(100);
        flushAllAnimationFrames(animationFrameQueue);

        expect(scrollIntoViewSpy).not.toHaveBeenCalled();

        view.destroy();
    });

    it('uses a single next-frame reveal and skips viewport listeners in internal-scroll mode', () => {
        const visualViewport = createMockVisualViewport(260);
        Object.defineProperty(window, 'visualViewport', {
            configurable: true,
            value: visualViewport,
        });

        const { view, cellElement, scrollIntoViewSpy } = createMainView({
            scrollHeight: 600,
            clientHeight: 300,
            scrollDOMRect: createRect(0, 180),
            widgetRect: createRect(0, 100, 0, 120),
            cellRect: createRect(40, 70, 180, 260),
        });

        openNestedEditor({
            mainView: view,
            cellElement,
            activeCell: ACTIVE_CELL,
            featureSettings: DEFAULT_FEATURE_SETTINGS,
        });

        expect(visualViewport.addEventListener).not.toHaveBeenCalled();
        expect(scrollIntoViewSpy).not.toHaveBeenCalled();

        flushAllAnimationFrames(animationFrameQueue);
        expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);

        view.destroy();
    });

    it('cancels pending timers and viewport listeners on close', () => {
        const visualViewport = createMockVisualViewport(240);
        Object.defineProperty(window, 'visualViewport', {
            configurable: true,
            value: visualViewport,
        });

        const { view, cellElement, scrollIntoViewSpy } = createMainView({
            scrollHeight: 300,
            clientHeight: 300,
            cellRect: createRect(260, 300),
        });

        openNestedEditor({
            mainView: view,
            cellElement,
            activeCell: ACTIVE_CELL,
            featureSettings: DEFAULT_FEATURE_SETTINGS,
        });
        closeNestedEditor(view);

        jest.advanceTimersByTime(500);
        flushAllAnimationFrames(animationFrameQueue);

        expect(scrollIntoViewSpy).not.toHaveBeenCalled();
        expect(visualViewport.removeEventListener).toHaveBeenCalledTimes(2);

        view.destroy();
    });
});
