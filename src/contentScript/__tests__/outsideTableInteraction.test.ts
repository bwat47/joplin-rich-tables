import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { activeCellField, getActiveCell, setActiveCellEffect } from '../tableState/activeCellState';
import { closeOnOutsideMouseDown, handleOutsideMouseDown } from '../tableRuntime/interaction/outsideTableInteraction';

const DOC = 'above\nbelow';
const INITIAL_SELECTION = 2;
const VALID_CLICK_POSITION = 8;

const mountedViews: EditorView[] = [];

function mountActiveView(laterMouseDown?: (event: MouseEvent) => boolean, doc = DOC): EditorView {
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const view = new EditorView({
        parent,
        doc,
        selection: { anchor: INITIAL_SELECTION },
        extensions: [
            activeCellField,
            closeOnOutsideMouseDown,
            ...(laterMouseDown ? [EditorView.domEventHandlers({ mousedown: laterMouseDown })] : []),
        ],
    });
    activateCell(view);
    mountedViews.push(view);
    return view;
}

function activateCell(view: EditorView): void {
    view.dispatch({
        effects: setActiveCellEffect.of({
            tableFrom: 0,
            section: 'header',
            row: 0,
            col: 0,
        }),
    });
}

function makeOutsideMouseDown(view: EditorView): MouseEvent {
    const target = document.createElement('span');
    view.contentDOM.appendChild(target);

    const event = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 24,
        clientY: 12,
    });
    Object.defineProperty(event, 'target', { value: target });
    return event;
}

afterEach(() => {
    while (mountedViews.length > 0) {
        mountedViews.pop()?.destroy();
    }
    document.body.replaceChildren();
    vi.restoreAllMocks();
});

describe('outside table interaction', () => {
    it('moves the caret to the mapped coordinate and closes the table', async () => {
        const view = mountActiveView();
        vi.spyOn(view, 'posAtCoords').mockReturnValue(VALID_CLICK_POSITION);
        const focus = vi.spyOn(view, 'focus').mockImplementation(() => undefined);

        handleOutsideMouseDown(view, makeOutsideMouseDown(view));
        await Promise.resolve();

        expect(view.state.selection.main.anchor).toBe(VALID_CLICK_POSITION);
        expect(getActiveCell(view.state)).toBeNull();
        expect(focus).toHaveBeenCalledOnce();
    });

    it('leaves the press to CodeMirror so a drag can extend the selection', async () => {
        // Registered after the outside handler, so it only runs when that handler declines the
        // press. Taking it here keeps CodeMirror's built-in mouse selection out of jsdom.
        const laterMouseDown = vi.fn(() => true);
        const view = mountActiveView(laterMouseDown);
        vi.spyOn(view, 'posAtCoords').mockReturnValue(VALID_CLICK_POSITION);
        vi.spyOn(view, 'focus').mockImplementation(() => undefined);

        view.contentDOM.dispatchEvent(makeOutsideMouseDown(view));
        await Promise.resolve();

        expect(getActiveCell(view.state)).toBeNull();
        expect(laterMouseDown).toHaveBeenCalledOnce();
    });

    it.each([
        ['null', null],
        ['undefined', undefined],
        ['NaN', Number.NaN],
        ['negative', -1],
        ['fractional', 1.5],
        ['past the document end', DOC.length + 1],
    ])('closes the table but leaves the caret alone when coordinate mapping returns %s', async (_label, mappedPos) => {
        const view = mountActiveView();
        vi.spyOn(view, 'posAtCoords').mockReturnValue(mappedPos as never);
        const focus = vi.spyOn(view, 'focus').mockImplementation(() => undefined);

        handleOutsideMouseDown(view, makeOutsideMouseDown(view));
        await Promise.resolve();

        expect(view.state.selection.main.anchor).toBe(INITIAL_SELECTION);
        expect(getActiveCell(view.state)).toBeNull();
        expect(focus).not.toHaveBeenCalled();
    });

    it('accepts both document boundaries as valid positions', async () => {
        const view = mountActiveView();
        const posAtCoords = vi.spyOn(view, 'posAtCoords');
        vi.spyOn(view, 'focus').mockImplementation(() => undefined);

        posAtCoords.mockReturnValueOnce(0);
        handleOutsideMouseDown(view, makeOutsideMouseDown(view));
        await Promise.resolve();
        expect(view.state.selection.main.anchor).toBe(0);

        activateCell(view);
        posAtCoords.mockReturnValueOnce(DOC.length);
        handleOutsideMouseDown(view, makeOutsideMouseDown(view));
        await Promise.resolve();
        expect(view.state.selection.main.anchor).toBe(DOC.length);
    });

    it('keeps the clicked line when closing a tall cell changes coordinate mapping', async () => {
        const doc = [
            '',
            '| [SQL Server 6.0](https://sqlserverbuilds.blogspot.com/2006/01/sql-server-6.html "SQL 6.0 detail")<br><br>SQL Server 6<br>codename SQL95<br>Release date: 1995-06-13<br>Support end date: 1999-03-31 | 6.00.121 | 6.00.124 | 6.00.139 | 6.00.151 |  |',
            '| --- | --- | --- | --- | --- | --- |',
            '',
            'Test',
            'Text',
            'ABC',
        ].join('\n');
        const clickedPos = doc.indexOf('Test');
        const shiftedPos = doc.indexOf('ABC');
        // Model the native handler's second hit test: the same screen coordinates point
        // two lines lower if the preceding handler already closed the tall cell.
        const view = mountActiveView(() => {
            view.dispatch({ selection: { anchor: view.posAtCoords({ x: 24, y: 12 }, false) } });
            return true;
        }, doc);
        vi.spyOn(view, 'posAtCoords').mockImplementation(() => (getActiveCell(view.state) ? clickedPos : shiftedPos));

        view.contentDOM.dispatchEvent(makeOutsideMouseDown(view));
        await Promise.resolve();

        expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe('Test');
        expect(getActiveCell(view.state)).toBeNull();
    });

    it('preserves the range established by the native mouse handler', async () => {
        const view = mountActiveView(() => {
            view.dispatch({ selection: { anchor: INITIAL_SELECTION, head: DOC.length } });
            return true;
        });
        vi.spyOn(view, 'posAtCoords').mockReturnValue(VALID_CLICK_POSITION);

        view.contentDOM.dispatchEvent(makeOutsideMouseDown(view));
        await Promise.resolve();

        expect(view.state.selection.main.anchor).toBe(INITIAL_SELECTION);
        expect(view.state.selection.main.head).toBe(DOC.length);
        expect(getActiveCell(view.state)).toBeNull();
    });

    it('closes the table without moving the caret when the document changes before cleanup', async () => {
        const view = mountActiveView();
        vi.spyOn(view, 'posAtCoords').mockReturnValue(VALID_CLICK_POSITION);
        handleOutsideMouseDown(view, makeOutsideMouseDown(view));
        view.dispatch({ changes: { from: 0, to: DOC.length, insert: 'new' }, selection: { anchor: 0 } });
        await Promise.resolve();

        expect(view.state.selection.main.anchor).toBe(0);
        expect(getActiveCell(view.state)).toBeNull();
    });
});
