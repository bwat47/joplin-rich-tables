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
import { cellDragField, endCellDragEffect, startCellDragEffect } from '../tableState/cellDragState';
import {
    cellSelectionFocusPlugin,
    setCellDragSelection,
    startCellSelectionFromActiveCell,
} from '../tableRuntime/selection/cellSelectionController';
import { cellSelectionKeyCapturePlugin } from '../tableRuntime/selection/cellSelectionKeymap';
import { triggerOpenCellRequestEffect } from '../tableRuntime/openCellRequest';

const markdownExtension = markdown({
    extensions: [GFM],
});

/** Table with three columns and two body rows, so selection can move in every direction. */
const GRID_DOC = ['| H1 | H2 | H3 |', '| --- | --- | --- |', '| a1 | a2 | a3 |', '| b1 | b2 | b3 |'].join('\n');

const mountedViews: EditorView[] = [];

/** Waits for CodeMirror's measure cycle, which it schedules on an animation frame. */
function flushMeasure(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => resolve());
    });
}

function mountSelectionView(doc: string): EditorView {
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const view = new EditorView({
        parent,
        extensions: [
            markdownExtension,
            history(),
            activeCellField,
            cellSelectionField,
            cellDragField,
            cellSelectionKeyCapturePlugin,
            cellSelectionFocusPlugin,
        ],
        doc,
    });
    mountedViews.push(view);

    return view;
}

function pressKey(init: KeyboardEventInit & { key: string }): void {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

afterEach(() => {
    vi.restoreAllMocks();
    // Destroy here rather than per-test so a failing assertion cannot leak the
    // plugin's document-level keydown listener into the next test.
    while (mountedViews.length > 0) {
        mountedViews.pop()?.destroy();
    }
    document.body.replaceChildren();
});

describe('cellSelectionKeymap', () => {
    it('leaves key ownership with the anchor cell while a mouse drag is in progress', () => {
        const view = mountSelectionView(GRID_DOC);
        const anchor = { section: 'body', row: 0, col: 0 } as const;
        view.dispatch({
            effects: [
                setActiveCellEffect.of({ tableFrom: 0, ...anchor }),
                setCellSelectionEffect.of({
                    tableFrom: 0,
                    anchor,
                    focus: { section: 'body', row: 0, col: 1 },
                }),
                startCellDragEffect.of(undefined),
            ],
        });

        pressKey({ key: 'Escape' });

        expect(getActiveCell(view.state)).toMatchObject(anchor);
        expect(getCellSelection(view.state)).not.toBeNull();
    });

    it('returns key ownership to the selection once the drag ends', () => {
        const view = mountSelectionView(GRID_DOC);
        view.dispatch({
            effects: [
                setCellSelectionEffect.of({
                    tableFrom: 0,
                    anchor: { section: 'body', row: 0, col: 0 },
                    focus: { section: 'body', row: 0, col: 1 },
                }),
                startCellDragEffect.of(undefined),
            ],
        });
        view.dispatch({ effects: endCellDragEffect.of(undefined) });

        pressKey({ key: 'Escape' });

        expect(getCellSelection(view.state)).toBeNull();
    });

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

    it.each([
        { label: 'Ctrl+Backspace', init: { key: 'Backspace', ctrlKey: true } },
        { label: 'Ctrl+Delete', init: { key: 'Delete', ctrlKey: true } },
        { label: 'Shift+Backspace', init: { key: 'Backspace', shiftKey: true } },
        { label: 'Option+Backspace', init: { key: 'Backspace', altKey: true } },
        { label: 'Option+Delete', init: { key: 'Delete', altKey: true } },
        { label: 'Command+Backspace', init: { key: 'Backspace', metaKey: true } },
        { label: 'Command+Delete', init: { key: 'Delete', metaKey: true } },
    ])('routes $label through selection removal', ({ init }) => {
        const view = mountSelectionView(['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n'));

        view.dispatch({
            effects: setCellSelectionEffect.of({
                tableFrom: 0,
                anchor: { section: 'body', row: 0, col: 0 },
                focus: { section: 'body', row: 0, col: 1 },
            }),
        });

        pressKey(init);

        expect(view.state.doc.toString()).toBe(['| H1 | H2 |', '| --- | --- |', '|  |  |'].join('\n'));
    });

    it('leaves Shift+Delete to the clipboard handler, since it is the platform cut gesture', () => {
        const initialDoc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
        const view = mountSelectionView(initialDoc);

        view.dispatch({
            effects: setCellSelectionEffect.of({
                tableFrom: 0,
                anchor: { section: 'body', row: 0, col: 0 },
                focus: { section: 'body', row: 0, col: 1 },
            }),
        });

        pressKey({ key: 'Delete', shiftKey: true });

        expect(view.state.doc.toString()).toBe(initialDoc);
    });

    it.each([
        { label: 'Ctrl+X', init: { key: 'x', ctrlKey: true } },
        { label: 'Command+X', init: { key: 'x', metaKey: true } },
        { label: 'Shift+Delete', init: { key: 'Delete', shiftKey: true } },
        { label: 'Ctrl+Insert', init: { key: 'Insert', ctrlKey: true } },
        { label: 'Shift+Insert', init: { key: 'Insert', shiftKey: true } },
    ])('isolates $label from the root editor without suppressing its clipboard event', ({ init }) => {
        const view = mountSelectionView(['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n'));
        view.dispatch({
            effects: setCellSelectionEffect.of({
                tableFrom: 0,
                anchor: { section: 'body', row: 0, col: 0 },
                focus: { section: 'body', row: 0, col: 1 },
            }),
        });
        view.focus();

        const rootKeyDown = vi.fn();
        view.contentDOM.addEventListener('keydown', rootKeyDown);
        const event = new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            ...init,
        });
        view.contentDOM.dispatchEvent(event);

        expect(rootKeyDown).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
        expect(getCellSelection(view.state)).not.toBeNull();
    });

    it.each([
        { label: 'Ctrl+Shift+C', init: { key: 'c', ctrlKey: true, shiftKey: true } },
        { label: 'Ctrl+Shift+V', init: { key: 'v', ctrlKey: true, shiftKey: true } },
    ])('leaves $label to the root editor, since it is not a plain clipboard chord', ({ init }) => {
        const view = mountSelectionView(['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n'));
        view.dispatch({
            effects: setCellSelectionEffect.of({
                tableFrom: 0,
                anchor: { section: 'body', row: 0, col: 0 },
                focus: { section: 'body', row: 0, col: 1 },
            }),
        });
        view.focus();

        const rootKeyDown = vi.fn();
        view.contentDOM.addEventListener('keydown', rootKeyDown);
        view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));

        expect(rootKeyDown).toHaveBeenCalledTimes(1);
    });

    it('does not isolate clipboard shortcuts when focus belongs to an external control', () => {
        const view = mountSelectionView(['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n'));
        view.dispatch({
            effects: setCellSelectionEffect.of({
                tableFrom: 0,
                anchor: { section: 'body', row: 0, col: 0 },
                focus: { section: 'body', row: 0, col: 1 },
            }),
        });

        const externalInput = document.createElement('input');
        document.body.appendChild(externalInput);
        externalInput.focus();
        const inputKeyDown = vi.fn();
        externalInput.addEventListener('keydown', inputKeyDown);
        externalInput.dispatchEvent(
            new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'x',
                ctrlKey: true,
            })
        );

        expect(inputKeyDown).toHaveBeenCalledTimes(1);
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

    it.each([{ key: 'Escape' as const }, { key: 'Tab' as const }, { key: 'Enter' as const }])(
        'activates the focus cell editor on $key while multi-cell selection is active',
        ({ key }) => {
            const table = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
            const view = mountSelectionView(table);

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
            // The fixture table sits flush against both document edges, so entry pads it.
            expect(view.state.doc.toString()).toBe(`\n${table}\n`);
            expect(getActiveCell(view.state)).toMatchObject({
                tableFrom: view.state.doc.toString().indexOf(table),
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

    it('reopens the anchor editor when Shift+Arrow contracts a multi-cell selection to one cell', () => {
        const prefix = 'above\n\n';
        const view = mountSelectionView(`${prefix}${GRID_DOC}\n\nbelow`);
        view.dispatch({
            effects: setCellSelectionEffect.of({
                tableFrom: prefix.length,
                anchor: { section: 'body', row: 0, col: 0 },
                focus: { section: 'body', row: 0, col: 1 },
            }),
        });

        pressKey({ key: 'ArrowLeft', shiftKey: true });

        expect(getCellSelection(view.state)).toBeNull();
        expect(getActiveCell(view.state)).toMatchObject({
            tableFrom: prefix.length,
            section: 'body',
            row: 0,
            col: 0,
        });
    });

    it('keeps a one-cell selection when Shift+Arrow is clamped at its anchor', () => {
        const view = mountSelectionView(GRID_DOC);
        const anchor = { section: 'header', row: 0, col: 0 } as const;
        view.dispatch({ effects: setCellSelectionEffect.of({ tableFrom: 0, anchor, focus: anchor }) });

        pressKey({ key: 'ArrowLeft', shiftKey: true });

        expect(getCellSelection(view.state)).toEqual({ tableFrom: 0, anchor, focus: anchor });
        expect(getActiveCell(view.state)).toBeNull();
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

    it('gives the main editor focus when a cell selection starts', () => {
        // Every gesture that starts a selection suppresses the browser's own focusing, so
        // without this focus stays parked on the body and the selection renders as unfocused.
        const view = mountSelectionView(['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n'));
        view.dispatch({
            effects: setActiveCellEffect.of({ tableFrom: 0, section: 'body', row: 0, col: 0 }),
        });
        const focusSpy = vi.spyOn(view, 'focus');

        expect(startCellSelectionFromActiveCell(view, 'right')).toBe(true);
        expect(focusSpy).toHaveBeenCalled();
    });

    it('leaves focus alone while a drag is still running', () => {
        // A drag does not disturb whatever had focus until the rectangle is final, and hands
        // focus over itself on release.
        const view = mountSelectionView(['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n'));
        const focusSpy = vi.spyOn(view, 'focus');

        expect(
            setCellDragSelection(view, 0, { section: 'body', row: 0, col: 0 }, { section: 'body', row: 0, col: 1 })
        ).toBe(true);
        expect(focusSpy).not.toHaveBeenCalled();
    });

    it('takes focus for a cell selection created outside the controller', async () => {
        // A paste inside a cell editor becomes a multi-cell paste in a transaction filter, which
        // has no view to focus with, so the selection arrives with focus on the document body.
        const view = mountSelectionView(['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n'));
        const focusSpy = vi.spyOn(view, 'focus');

        view.dispatch({
            effects: setCellSelectionEffect.of({
                tableFrom: 0,
                anchor: { section: 'body', row: 0, col: 0 },
                focus: { section: 'body', row: 0, col: 1 },
            }),
        });
        expect(focusSpy).not.toHaveBeenCalled();

        await flushMeasure();
        expect(focusSpy).toHaveBeenCalled();
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
