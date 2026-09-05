/**
 * @vitest-environment jsdom
 *
 * Characterization tests for the nested editor controller, driven through its
 * exported API and the DOM it owns. The nested EditorView is reached via
 * `EditorView.findFromDOM` on the cell's editor host rather than the
 * controller's private session, so these tests describe observable behavior.
 */

import { deleteCharForward } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultHostEditorConfig } from '../../contentScriptBridge/hostEditorConfigBridge';
import {
    cleanupHostedNestedEditors,
    closeNestedEditor,
    handleMainEditorUpdate,
    isNestedEditorOpen,
    nestedEditorPlugin,
    openNestedEditor,
    refocusNestedEditor,
} from '../nestedEditor/nestedEditorController';
import { markdownRenderServiceFacet, type MarkdownRenderService } from '../services/markdownRenderer';
import { resolvedActiveCellField } from '../tableRuntime/activeCell/resolvedActiveCell';
import { activeCellField, getActiveCell, setActiveCellEffect, type ActiveCell } from '../tableState/activeCellState';
import { CLASS_CELL_ACTIVE, CLASS_CELL_CONTENT, CLASS_CELL_EDITOR } from '../shared/tableDomClasses';

// jsdom does not implement Range measurement, which CodeMirror's selection layer calls.
if (!Range.prototype.getClientRects) {
    Object.defineProperty(Range.prototype, 'getClientRects', { value: () => [] });
}

const FEATURE_SETTINGS = defaultHostEditorConfig().nestedEditor;

function bodyCell(overrides: Partial<ActiveCell> = {}): ActiveCell {
    return { tableFrom: 0, section: 'body', row: 0, col: 0, ...overrides };
}

/**
 * Builds a main editor wired the way the runtime wires it: the controller only
 * reacts to main-document changes when the host forwards its view updates.
 */
function createHarness(params: {
    doc: string;
    activeCell?: ActiveCell;
    selection?: { anchor: number; head?: number };
}) {
    const renderer: MarkdownRenderService = {
        getCached: vi.fn(() => undefined),
        render: vi.fn(async () => ''),
        clear: vi.fn(),
    };

    const parent = document.createElement('div');
    document.body.appendChild(parent);

    let mainView: EditorView | null = null;
    const view = new EditorView({
        parent,
        state: EditorState.create({
            doc: params.doc,
            selection: params.selection,
            extensions: [
                markdown({ extensions: [GFM] }),
                activeCellField,
                resolvedActiveCellField,
                markdownRenderServiceFacet.of(renderer),
                nestedEditorPlugin,
                EditorView.updateListener.of((update) => {
                    if (mainView) {
                        handleMainEditorUpdate(mainView, update);
                    }
                }),
            ],
        }),
    });
    mainView = view;

    if (params.activeCell) {
        view.dispatch({ effects: setActiveCellEffect.of(params.activeCell) });
    }

    const cellElement = document.createElement('td');
    parent.appendChild(cellElement);

    return { view, cellElement, renderer, parent };
}

/** The nested editor mounted inside `cellElement`, or null when none is mounted. */
function nestedViewIn(cellElement: HTMLElement): EditorView | null {
    const host = cellElement.querySelector(`.${CLASS_CELL_EDITOR}`);
    return host ? EditorView.findFromDOM(host as HTMLElement) : null;
}

function requireNestedView(cellElement: HTMLElement): EditorView {
    const nested = nestedViewIn(cellElement);
    if (!nested) {
        throw new Error('Expected a nested editor to be mounted in the cell');
    }
    return nested;
}

describe('nestedEditorController open', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('mounts a nested editor holding the unsanitized cell text', () => {
        const doc = ['| H1 |', '| --- |', '| a \\| b<br>c |'].join('\n');
        const { view, cellElement } = createHarness({ doc, activeCell: bodyCell() });

        expect(openNestedEditor({ mainView: view, cellElement, featureSettings: FEATURE_SETTINGS })).toBe(true);
        expect(isNestedEditorOpen(view)).toBe(true);
        expect(cellElement.classList.contains(CLASS_CELL_ACTIVE)).toBe(true);
        expect(requireNestedView(cellElement).state.doc.toString()).toBe('a | b\nc');

        view.destroy();
    });

    it('returns false and mounts nothing when no active cell resolves', () => {
        const doc = ['| H1 |', '| --- |', '| abc |'].join('\n');
        const { view, cellElement } = createHarness({ doc });

        expect(openNestedEditor({ mainView: view, cellElement, featureSettings: FEATURE_SETTINGS })).toBe(false);
        expect(isNestedEditorOpen(view)).toBe(false);
        expect(nestedViewIn(cellElement)).toBeNull();

        view.destroy();
    });

    it('mirrors the main editor selection into the nested editor by default', () => {
        const doc = ['| H1 |', '| --- |', '| abcdef |'].join('\n');
        const cellStart = doc.indexOf('abcdef');
        const { view, cellElement } = createHarness({
            doc,
            activeCell: bodyCell(),
            selection: { anchor: cellStart + 2, head: cellStart + 4 },
        });

        openNestedEditor({ mainView: view, cellElement, featureSettings: FEATURE_SETTINGS });

        expect(requireNestedView(cellElement).state.selection.main).toMatchObject({ from: 2, to: 4 });

        view.destroy();
    });

    it.each([
        ['start', 0],
        ['end', 'first\nsecond'.length],
        ['lastLineStart', 'first\n'.length],
    ] as const)('places the caret for initialCursorPos %s', (initialCursorPos, expectedPos) => {
        // Root text `first<br>second` unsanitizes to the two-line local text `first\nsecond`.
        const doc = ['| H1 |', '| --- |', '| first<br>second |'].join('\n');
        const { view, cellElement } = createHarness({ doc, activeCell: bodyCell() });

        openNestedEditor({ mainView: view, cellElement, featureSettings: FEATURE_SETTINGS, initialCursorPos });

        const nested = requireNestedView(cellElement);
        expect(nested.state.selection.main).toMatchObject({ anchor: expectedPos, head: expectedPos });

        view.destroy();
    });

    it('closes a previously open cell before opening the next one', () => {
        const doc = ['| H1 | H2 |', '| --- | --- |', '| aaa | bbb |'].join('\n');
        const { view, cellElement, parent } = createHarness({ doc, activeCell: bodyCell() });

        openNestedEditor({ mainView: view, cellElement, featureSettings: FEATURE_SETTINGS });

        const secondCell = document.createElement('td');
        parent.appendChild(secondCell);
        view.dispatch({ effects: setActiveCellEffect.of(bodyCell({ col: 1 })) });
        openNestedEditor({ mainView: view, cellElement: secondCell, featureSettings: FEATURE_SETTINGS });

        expect(nestedViewIn(cellElement)).toBeNull();
        expect(cellElement.classList.contains(CLASS_CELL_ACTIVE)).toBe(false);
        expect(requireNestedView(secondCell).state.doc.toString()).toBe('bbb');

        view.destroy();
    });
});

describe('nestedEditorController local-to-root forwarding', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it.each(['header', 'body'] as const)(
        'keeps delimiter padding outside the %s editor after typing a backslash',
        (section) => {
            const originalText = 'abc';
            const editedText = `${originalText}\\`;
            const lines = ['| abc | next |', '| --- | --- |', '| abc | next |'];
            const { view, cellElement } = createHarness({
                doc: lines.join('\n'),
                activeCell: bodyCell({ section }),
            });

            try {
                openNestedEditor({ mainView: view, cellElement, featureSettings: FEATURE_SETTINGS });
                const nested = requireNestedView(cellElement);
                nested.dispatch({
                    changes: { from: originalText.length, insert: '\\' },
                    selection: { anchor: editedText.length },
                });

                // Delete at the cell's end must not expose or remove the space protecting the next pipe.
                deleteCharForward(nested);

                const editedLine = section === 'header' ? 0 : 2;
                lines[editedLine] = `| ${editedText} | next |`;
                expect(view.state.doc.toString()).toBe(lines.join('\n'));
                expect(nested.state.doc.toString()).toBe(editedText);
                expect(nested.state.selection.main.anchor).toBe(editedText.length);
            } finally {
                view.destroy();
            }
        }
    );

    it('sanitizes nested edits back into the main document', () => {
        const doc = ['| H1 |', '| --- |', '| abc |'].join('\n');
        const { view, cellElement } = createHarness({ doc, activeCell: bodyCell() });

        openNestedEditor({ mainView: view, cellElement, featureSettings: FEATURE_SETTINGS });
        const nested = requireNestedView(cellElement);
        nested.dispatch({ changes: { from: 0, to: nested.state.doc.length, insert: 'x | y\nz' } });

        expect(view.state.doc.toString()).toContain('| x \\| y<br>z |');

        view.destroy();
    });

    it('moves the main selection without editing the document when only the nested caret moves', () => {
        const doc = ['| H1 |', '| --- |', '| abcdef |'].join('\n');
        const cellStart = doc.indexOf('abcdef');
        const { view, cellElement } = createHarness({ doc, activeCell: bodyCell() });

        openNestedEditor({ mainView: view, cellElement, featureSettings: FEATURE_SETTINGS });
        const nested = requireNestedView(cellElement);
        nested.dispatch({ selection: EditorSelection.single(3) });

        expect(view.state.doc.toString()).toBe(doc);
        expect(view.state.selection.main).toMatchObject({ anchor: cellStart + 3, head: cellStart + 3 });

        view.destroy();
    });

    it('maps the main selection across escaped pipes in the cell text', () => {
        const doc = ['| H1 |', '| --- |', '| a \\| b |'].join('\n');
        const cellStart = doc.indexOf('a \\| b');
        const { view, cellElement } = createHarness({ doc, activeCell: bodyCell() });

        openNestedEditor({ mainView: view, cellElement, featureSettings: FEATURE_SETTINGS });
        const nested = requireNestedView(cellElement);
        // Local text is `a | b`; the caret after the pipe sits one char later in root text.
        nested.dispatch({ selection: EditorSelection.single(3) });

        expect(view.state.selection.main.anchor).toBe(cellStart + 4);

        view.destroy();
    });
});

describe('nestedEditorController handleMainEditorUpdate', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('rebases the nested editor when the cell text changes in the main editor', () => {
        const doc = ['| H1 |', '| --- |', '| abc |'].join('\n');
        const cellStart = doc.indexOf('abc');
        const { view, cellElement } = createHarness({ doc, activeCell: bodyCell() });

        openNestedEditor({ mainView: view, cellElement, featureSettings: FEATURE_SETTINGS });
        view.dispatch({ changes: { from: cellStart, to: cellStart + 3, insert: 'updated' } });

        expect(requireNestedView(cellElement).state.doc.toString()).toBe('updated');

        view.destroy();
    });

    it('keeps the session open when the change lands outside the active table', () => {
        const doc = ['intro', '', '| H1 |', '| --- |', '| abc |'].join('\n');
        const tableFrom = doc.indexOf('| H1 |');
        const { view, cellElement } = createHarness({
            doc,
            activeCell: bodyCell({ tableFrom }),
        });

        openNestedEditor({ mainView: view, cellElement, featureSettings: FEATURE_SETTINGS });
        view.dispatch({ changes: { from: 0, to: 0, insert: 'more ' } });

        expect(isNestedEditorOpen(view)).toBe(true);
        expect(requireNestedView(cellElement).state.doc.toString()).toBe('abc');

        view.destroy();
    });

    it('closes the editor and clears the active cell when the table is deleted', () => {
        const doc = ['| H1 |', '| --- |', '| abc |'].join('\n');
        const { view, cellElement } = createHarness({ doc, activeCell: bodyCell() });

        openNestedEditor({ mainView: view, cellElement, featureSettings: FEATURE_SETTINGS });
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'no table here' } });

        expect(isNestedEditorOpen(view)).toBe(false);
        expect(getActiveCell(view.state)).toBeNull();
        expect(nestedViewIn(cellElement)).toBeNull();

        view.destroy();
    });
});

describe('nestedEditorController close', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('tears down the nested editor and renders the cell markdown back into the content wrapper', () => {
        const doc = ['| H1 |', '| --- |', '| **bold** |'].join('\n');
        const { view, cellElement, renderer } = createHarness({ doc, activeCell: bodyCell() });
        vi.mocked(renderer.getCached).mockReturnValue('<p><strong>bold</strong></p>');

        openNestedEditor({ mainView: view, cellElement, featureSettings: FEATURE_SETTINGS });
        closeNestedEditor(view);

        expect(isNestedEditorOpen(view)).toBe(false);
        expect(nestedViewIn(cellElement)).toBeNull();
        expect(cellElement.classList.contains(CLASS_CELL_ACTIVE)).toBe(false);
        expect(renderer.getCached).toHaveBeenCalledWith('**bold**');
        expect(cellElement.querySelector(`.${CLASS_CELL_CONTENT}`)?.innerHTML).toBe('<p><strong>bold</strong></p>');

        view.destroy();
    });

    it('renders the explicitly supplied range instead of re-resolving the cell', () => {
        const doc = ['| H1 |', '| --- |', '| abc |'].join('\n');
        const { view, cellElement, renderer } = createHarness({ doc, activeCell: bodyCell() });

        openNestedEditor({ mainView: view, cellElement, featureSettings: FEATURE_SETTINGS });
        closeNestedEditor(view, { contentFrom: 2, contentTo: 4 });

        expect(renderer.getCached).toHaveBeenCalledWith('H1');

        view.destroy();
    });

    it('is a no-op when nothing is open', () => {
        const doc = ['| H1 |', '| --- |', '| abc |'].join('\n');
        const { view, renderer } = createHarness({ doc, activeCell: bodyCell() });

        closeNestedEditor(view);

        expect(isNestedEditorOpen(view)).toBe(false);
        expect(renderer.getCached).not.toHaveBeenCalled();

        view.destroy();
    });
});

describe('nestedEditorController host cleanup', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('closes the session when the container hosting the editor is torn down', () => {
        const doc = ['| H1 |', '| --- |', '| abc |'].join('\n');
        const { view, cellElement, parent } = createHarness({ doc, activeCell: bodyCell() });

        openNestedEditor({ mainView: view, cellElement, featureSettings: FEATURE_SETTINGS });
        cleanupHostedNestedEditors(view, parent);

        expect(isNestedEditorOpen(view)).toBe(false);

        view.destroy();
    });

    it('leaves the session alone for an unrelated container', () => {
        const doc = ['| H1 |', '| --- |', '| abc |'].join('\n');
        const { view, cellElement } = createHarness({ doc, activeCell: bodyCell() });

        openNestedEditor({ mainView: view, cellElement, featureSettings: FEATURE_SETTINGS });
        cleanupHostedNestedEditors(view, document.createElement('div'));

        expect(isNestedEditorOpen(view)).toBe(true);

        view.destroy();
    });

    it('tolerates refocus and cleanup calls with no open session', () => {
        const doc = ['| H1 |', '| --- |', '| abc |'].join('\n');
        const { view, parent } = createHarness({ doc, activeCell: bodyCell() });

        expect(() => refocusNestedEditor(view)).not.toThrow();
        expect(() => cleanupHostedNestedEditors(view, parent)).not.toThrow();

        view.destroy();
    });
});
