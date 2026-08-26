/**
 * @vitest-environment jsdom
 */

vi.mock('../tableWidget/domHelpers', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../tableWidget/domHelpers')>()),
    findCellElement: vi.fn(() => ({})),
}));

import { history, undo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import { activeCellField, getActiveCell, setActiveCellEffect } from '../tableState/activeCellState';
import { setCellSelectionEffect, getCellSelection, cellSelectionField } from '../tableState/cellSelectionState';
import { startCellSelectionFromActiveCell } from '../tableRuntime/selection/cellSelectionController';
import { cellSelectionKeyCapturePlugin } from '../tableRuntime/selection/cellSelectionKeymap';
import { triggerOpenCellRequestEffect } from '../tableRuntime/openCellRequest';

const markdownExtension = markdown({
    extensions: [GFM],
});

/** Table with three columns and two body rows, so selection can move in every direction. */
const GRID_DOC = ['| H1 | H2 | H3 |', '| --- | --- | --- |', '| a1 | a2 | a3 |', '| b1 | b2 | b3 |'].join('\n');

const mountedViews: EditorView[] = [];

function mountSelectionView(doc: string): EditorView {
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const view = new EditorView({
        parent,
        extensions: [markdownExtension, history(), activeCellField, cellSelectionField, cellSelectionKeyCapturePlugin],
        doc,
    });
    mountedViews.push(view);

    return view;
}

function pressKey(init: KeyboardEventInit & { key: string }): void {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

afterEach(() => {
    // Destroy here rather than per-test so a failing assertion cannot leak the
    // plugin's document-level keydown listener into the next test.
    while (mountedViews.length > 0) {
        mountedViews.pop()?.destroy();
    }
    document.body.replaceChildren();
});

describe('cellSelectionKeymap', () => {
    it('routes undo through the main editor while a multi-cell selection is active', () => {
        const view = mountSelectionView(['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n'));

        view.dispatch({
            changes: {
                from: view.state.doc.length,
                to: view.state.doc.length,
                insert: '\n| b1 | b2 |',
            },
            effects: setCellSelectionEffect.of({
                tableFrom: 0,
                anchor: { section: 'body', row: 1, col: 0 },
                focus: { section: 'body', row: 1, col: 1 },
            }),
        });

        expect(view.state.doc.toString()).toContain('| b1 | b2 |');
        expect(getCellSelection(view.state)).not.toBeNull();

        pressKey({ key: 'z', ctrlKey: true });

        expect(view.state.doc.toString()).not.toContain('| b1 | b2 |');
        expect(getCellSelection(view.state)).toBeNull();
    });

    it.each([
        { label: 'Ctrl+Y', init: { key: 'y', ctrlKey: true } },
        { label: 'Ctrl+Shift+Z', init: { key: 'z', ctrlKey: true, shiftKey: true } },
    ])('routes redo through the main editor via $label', ({ init }) => {
        const view = mountSelectionView(['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n'));

        view.dispatch({
            changes: {
                from: view.state.doc.length,
                to: view.state.doc.length,
                insert: '\n| b1 | b2 |',
            },
        });
        // Undo directly so the redo stack is primed without the keymap's refocus,
        // which would otherwise park focus on the contenteditable and suppress the
        // next document-level shortcut.
        undo(view);
        expect(view.state.doc.toString()).not.toContain('| b1 | b2 |');

        view.dispatch({
            effects: setCellSelectionEffect.of({
                tableFrom: 0,
                anchor: { section: 'body', row: 0, col: 0 },
                focus: { section: 'body', row: 0, col: 1 },
            }),
        });

        pressKey(init);

        expect(view.state.doc.toString()).toContain('| b1 | b2 |');
    });

    it('routes Delete through selection removal while a multi-cell selection is active', () => {
        const view = mountSelectionView(
            ['| H1 |  | H3 |', '| --- | --- | --- |', '| A1 |  | A3 |', '| B1 |  | B3 |'].join('\n')
        );

        view.dispatch({
            effects: setCellSelectionEffect.of({
                tableFrom: 0,
                anchor: { section: 'header', row: 0, col: 1 },
                focus: { section: 'body', row: 1, col: 1 },
            }),
        });

        pressKey({ key: 'Delete' });

        expect(view.state.doc.toString()).toBe(
            ['| H1 | H3 |', '| --- | --- |', '| A1 | A3 |', '| B1 | B3 |'].join('\n')
        );
        expect(getCellSelection(view.state)).toEqual({
            tableFrom: 0,
            anchor: { section: 'header', row: 0, col: 1 },
            focus: { section: 'body', row: 1, col: 1 },
        });
    });

    it('routes Backspace through selection removal while a multi-cell selection is active', () => {
        const view = mountSelectionView(['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n'));

        view.dispatch({
            effects: setCellSelectionEffect.of({
                tableFrom: 0,
                anchor: { section: 'body', row: 0, col: 0 },
                focus: { section: 'body', row: 0, col: 1 },
            }),
        });

        pressKey({ key: 'Backspace' });

        expect(view.state.doc.toString()).toBe(['| H1 | H2 |', '| --- | --- |', '|  |  |'].join('\n'));
        expect(getCellSelection(view.state)).toEqual({
            tableFrom: 0,
            anchor: { section: 'body', row: 0, col: 0 },
            focus: { section: 'body', row: 0, col: 1 },
        });
    });

    it.each(['shiftKey', 'altKey', 'ctrlKey', 'metaKey'] as const)('ignores Delete combined with %s', (modifier) => {
        const initialDoc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
        const view = mountSelectionView(initialDoc);

        view.dispatch({
            effects: setCellSelectionEffect.of({
                tableFrom: 0,
                anchor: { section: 'body', row: 0, col: 0 },
                focus: { section: 'body', row: 0, col: 1 },
            }),
        });

        pressKey({ key: 'Delete', [modifier]: true });

        expect(view.state.doc.toString()).toBe(initialDoc);
    });

    it('focuses the main editor after deleting an emptied table via multi-cell selection', () => {
        const view = mountSelectionView(['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n'));
        const focusSpy = vi.spyOn(view, 'focus');

        view.dispatch({
            effects: setCellSelectionEffect.of({
                tableFrom: 0,
                anchor: { section: 'header', row: 0, col: 0 },
                focus: { section: 'body', row: 0, col: 1 },
            }),
        });

        pressKey({ key: 'Delete' });

        expect(view.state.doc.toString()).toBe(['|  |  |', '| --- | --- |', '|  |  |'].join('\n'));
        expect(getCellSelection(view.state)).toEqual({
            tableFrom: 0,
            anchor: { section: 'header', row: 0, col: 0 },
            focus: { section: 'body', row: 0, col: 1 },
        });

        focusSpy.mockClear();

        pressKey({ key: 'Delete' });

        expect(view.state.doc.toString()).toBe('');
        expect(getCellSelection(view.state)).toBeNull();
        expect(view.state.selection.main.anchor).toBe(0);
        expect(focusSpy).toHaveBeenCalledTimes(1);
    });

    it('ignores Delete when multi-cell selection mode is not active', () => {
        const initialDoc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
        const view = mountSelectionView(initialDoc);

        pressKey({ key: 'Delete' });

        expect(view.state.doc.toString()).toBe(initialDoc);
        expect(getCellSelection(view.state)).toBeNull();
    });

    it('clears the selection on Escape', () => {
        const view = mountSelectionView(GRID_DOC);

        view.dispatch({
            effects: setCellSelectionEffect.of({
                tableFrom: 0,
                anchor: { section: 'body', row: 0, col: 0 },
                focus: { section: 'body', row: 0, col: 1 },
            }),
        });

        pressKey({ key: 'Escape' });

        expect(getCellSelection(view.state)).toBeNull();
    });

    it.each([{ key: 'Tab' as const }, { key: 'Enter' as const }])(
        'activates the focus cell editor on $key while multi-cell selection is active',
        ({ key }) => {
            const view = mountSelectionView(['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n'));

            const dispatchSpy = vi.spyOn(view, 'dispatch');
            view.dispatch({
                effects: setCellSelectionEffect.of({
                    tableFrom: 0,
                    anchor: { section: 'body', row: 0, col: 0 },
                    focus: { section: 'body', row: 0, col: 1 },
                }),
            });

            pressKey({ key });

            expect(getCellSelection(view.state)).toBeNull();
            expect(getActiveCell(view.state)).toMatchObject({
                tableFrom: 0,
                section: 'body',
                row: 0,
                col: 1,
            });
            const lastSpec = dispatchSpy.mock.calls[dispatchSpy.mock.calls.length - 1]?.[0];
            const effects = Array.isArray(lastSpec?.effects) ? lastSpec.effects : [lastSpec?.effects];
            expect(effects.some((effect) => effect?.is?.(triggerOpenCellRequestEffect))).toBe(true);
        }
    );

    it.each([{ key: 'Tab' as const }, { key: 'Enter' as const }])(
        'leaves the selection untouched on Shift+$key',
        ({ key }) => {
            const view = mountSelectionView(['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n'));

            const selection = {
                tableFrom: 0,
                anchor: { section: 'body', row: 0, col: 0 },
                focus: { section: 'body', row: 0, col: 1 },
            } as const;
            view.dispatch({ effects: setCellSelectionEffect.of(selection) });

            pressKey({ key, shiftKey: true });

            expect(getCellSelection(view.state)).toEqual(selection);
            expect(getActiveCell(view.state)).toBeNull();
        }
    );

    // Each direction is wired up by hand in the keymap's dispatch table, so a
    // transposed entry would be invisible without per-direction coverage.
    it.each([
        { key: 'ArrowRight', expected: { section: 'body', row: 0, col: 2 } },
        { key: 'ArrowLeft', expected: { section: 'body', row: 0, col: 0 } },
        { key: 'ArrowDown', expected: { section: 'body', row: 1, col: 1 } },
        { key: 'ArrowUp', expected: { section: 'header', row: 0, col: 1 } },
    ])('extends the selection on Shift+$key', ({ key, expected }) => {
        const view = mountSelectionView(GRID_DOC);

        const anchor = { section: 'body', row: 0, col: 1 } as const;
        view.dispatch({
            effects: setCellSelectionEffect.of({ tableFrom: 0, anchor, focus: anchor }),
        });

        pressKey({ key, shiftKey: true });

        expect(getCellSelection(view.state)).toEqual({ tableFrom: 0, anchor, focus: expected });
    });

    it.each([
        { key: 'ArrowDown', edge: 'after' },
        { key: 'ArrowRight', edge: 'after' },
        { key: 'ArrowUp', edge: 'before' },
        { key: 'ArrowLeft', edge: 'before' },
    ])('collapses the selection $edge the table on $key without Shift', ({ key, edge }) => {
        const prefix = 'above';
        const view = mountSelectionView(`${prefix}\n${GRID_DOC}\nbelow`);
        const tableFrom = prefix.length + 1;
        view.dispatch({
            effects: setCellSelectionEffect.of({
                tableFrom,
                anchor: { section: 'header', row: 0, col: 0 },
                focus: { section: 'body', row: 1, col: 2 },
            }),
        });

        pressKey({ key });

        expect(getCellSelection(view.state)).toBeNull();
        expect(view.state.selection.main.head).toBe(
            edge === 'before' ? tableFrom - 1 : tableFrom + GRID_DOC.length + 1
        );
    });

    it.each(['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'])(
        'drops the selection on %s when the table has no adjacent line',
        (key) => {
            const view = mountSelectionView(GRID_DOC);
            view.dispatch({
                effects: setCellSelectionEffect.of({
                    tableFrom: 0,
                    anchor: { section: 'body', row: 0, col: 1 },
                    focus: { section: 'body', row: 0, col: 1 },
                }),
            });

            pressKey({ key });

            expect(getCellSelection(view.state)).toBeNull();
        }
    );

    it.each(['ArrowRight', 'ArrowDown'])('leaves %s with a modifier to the main editor', (key) => {
        const view = mountSelectionView(GRID_DOC);
        const selection = {
            tableFrom: 0,
            anchor: { section: 'body', row: 0, col: 1 },
            focus: { section: 'body', row: 0, col: 1 },
        } as const;
        view.dispatch({ effects: setCellSelectionEffect.of(selection) });

        pressKey({ key, ctrlKey: true });

        expect(getCellSelection(view.state)).toEqual(selection);
    });

    it('starts cell selection from a resolved active cell', () => {
        const view = mountSelectionView(['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n'));
        view.dispatch({
            effects: setActiveCellEffect.of({
                tableFrom: 0,
                section: 'body',
                row: 0,
                col: 0,
            }),
        });

        expect(startCellSelectionFromActiveCell(view, 'right')).toBe(true);
        expect(getActiveCell(view.state)).toBeNull();
        expect(getCellSelection(view.state)).toEqual({
            tableFrom: 0,
            anchor: { section: 'body', row: 0, col: 0 },
            focus: { section: 'body', row: 0, col: 1 },
        });
    });

    it('does not start cell selection from a stale active cell', () => {
        const view = mountSelectionView(['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n'));
        view.dispatch({
            effects: setActiveCellEffect.of({
                tableFrom: 0,
                section: 'body',
                row: 0,
                col: 99,
            }),
        });
        const dispatchSpy = vi.spyOn(view, 'dispatch');

        expect(startCellSelectionFromActiveCell(view, 'right')).toBe(false);
        expect(dispatchSpy).not.toHaveBeenCalled();
        expect(getCellSelection(view.state)).toBeNull();
    });
});
