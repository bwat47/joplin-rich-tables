/**
 * @jest-environment jsdom
 */

import { undo } from '@codemirror/commands';
import { history } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import { syncAnnotation } from '../editorBridge/syncAnnotation';
import { hostEditorConfigFacet } from '../services/hostEditorConfig';
import { createMarkdownRenderer, markdownRenderServiceFacet } from '../services/markdownRenderer';
import { nestedEditorPlugin, isNestedEditorOpen } from '../nestedEditor/nestedEditorController';
import { activeCellField, getActiveCell, setActiveCellEffect, type ActiveCell } from '../tableState/activeCellState';
import { openCellRequestField } from '../tableRuntime/openCellRequest';
import { resolvedActiveCellField, getResolvedActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import { nestedEditorLifecyclePlugin } from '../tableRuntime/lifecycle/nestedEditorLifecycle';
import { tableDecorationField } from '../tableWidget/tableDecorationField';
import { findCellElement } from '../tableWidget/domHelpers';
import { makeTableId } from '../tableModel/types';

class ResizeObserverMock {
    observe(): void {}
    disconnect(): void {}
}

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

const TEST_HOST_CONFIG = {
    nestedEditor: {
        autoMatchingBraces: true,
    },
    toolbar: {
        showMoveButtons: true,
        showClearButtons: true,
        showAlignmentButtons: true,
        showDeleteTableButton: true,
    },
};

describe('nested editor undo regression', () => {
    const originalResizeObserver = globalThis.ResizeObserver;
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    let animationFrameQueue: FrameRequestCallback[] = [];

    const flushAnimationFrames = (): void => {
        while (animationFrameQueue.length > 0) {
            const callback = animationFrameQueue.shift();
            callback?.(0);
        }
    };

    beforeEach(() => {
        globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
        animationFrameQueue = [];
        globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
            animationFrameQueue.push(callback);
            return animationFrameQueue.length;
        }) as typeof requestAnimationFrame;
    });

    afterEach(() => {
        globalThis.ResizeObserver = originalResizeObserver;
        globalThis.requestAnimationFrame = originalRequestAnimationFrame;
        document.body.innerHTML = '';
    });

    it('keeps the first body cell editor usable after undo restores deleted text in a single-table document', () => {
        const doc = ['| H1 |', '| --- |', '| abc |'].join('\n');
        const activeCell: ActiveCell = {
            tableFrom: 0,
            section: 'body',
            row: 0,
            col: 0,
        };
        const parent = document.createElement('div');
        document.body.appendChild(parent);
        const view = new EditorView({
            parent,
            state: EditorState.create({
                doc,
                selection: EditorSelection.single(doc.indexOf('abc') + 'abc'.length),
                extensions: [
                    history(),
                    markdown({ extensions: [GFM] }),
                    hostEditorConfigFacet.of(TEST_HOST_CONFIG),
                    markdownRenderServiceFacet.of(createMarkdownRenderer(async (markup, id) => ({ id, html: markup }))),
                    nestedEditorPlugin,
                    activeCellField,
                    resolvedActiveCellField,
                    openCellRequestField,
                    nestedEditorLifecyclePlugin,
                    tableDecorationField,
                ],
            }),
        });

        view.dispatch({ effects: setActiveCellEffect.of(activeCell) });
        const cellElement = findCellElement(view, makeTableId(activeCell.tableFrom), activeCell);
        expect(cellElement).not.toBeNull();
        if (!cellElement) {
            throw new Error('Expected first body cell element');
        }

        const opened = view.plugin(nestedEditorPlugin)?.controller.open({
            mainView: view,
            cellElement,
            featureSettings: TEST_HOST_CONFIG.nestedEditor,
        });
        expect(opened).toBe(true);
        expect(isNestedEditorOpen(view)).toBe(true);

        const resolved = getResolvedActiveCell(view.state);
        expect(resolved).not.toBeNull();
        if (!resolved) {
            throw new Error('Expected resolved active cell');
        }

        view.dispatch({
            changes: { from: resolved.editableFrom, to: resolved.editableTo, insert: '' },
            selection: EditorSelection.single(resolved.editableFrom),
            annotations: syncAnnotation.of(true),
        });

        expect(undo(view)).toBe(true);
        flushAnimationFrames();

        expect(getActiveCell(view.state)).toEqual(activeCell);
        expect(isNestedEditorOpen(view)).toBe(true);

        view.destroy();
    });
});
