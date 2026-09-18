import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { activeCellField, getActiveCell, setActiveCellEffect } from '../tableState/activeCellState';
import { closeOnOutsideMouseDown, handleOutsideMouseDown } from '../tableRuntime/interaction/outsideTableInteraction';

const DOC = 'above\nbelow';
const INITIAL_SELECTION = 2;
const VALID_CLICK_POSITION = 8;

const mountedViews: EditorView[] = [];

function mountActiveView(laterMouseDown?: (event: MouseEvent) => boolean): EditorView {
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const view = new EditorView({
        parent,
        doc: DOC,
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
    it('moves the caret to the mapped coordinate and closes the table', () => {
        const view = mountActiveView();
        vi.spyOn(view, 'posAtCoords').mockReturnValue(VALID_CLICK_POSITION);
        const focus = vi.spyOn(view, 'focus').mockImplementation(() => undefined);

        handleOutsideMouseDown(view, makeOutsideMouseDown(view));

        expect(view.state.selection.main.anchor).toBe(VALID_CLICK_POSITION);
        expect(getActiveCell(view.state)).toBeNull();
        expect(focus).toHaveBeenCalledOnce();
    });

    it('leaves the press to CodeMirror so a drag can extend the selection', () => {
        // Registered after the outside handler, so it only runs when that handler declines the
        // press. Taking it here keeps CodeMirror's built-in mouse selection out of jsdom.
        const laterMouseDown = vi.fn(() => true);
        const view = mountActiveView(laterMouseDown);
        vi.spyOn(view, 'posAtCoords').mockReturnValue(VALID_CLICK_POSITION);
        vi.spyOn(view, 'focus').mockImplementation(() => undefined);

        view.contentDOM.dispatchEvent(makeOutsideMouseDown(view));

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
    ])('closes the table but leaves the caret alone when coordinate mapping returns %s', (_label, mappedPos) => {
        const view = mountActiveView();
        vi.spyOn(view, 'posAtCoords').mockReturnValue(mappedPos as never);
        const focus = vi.spyOn(view, 'focus').mockImplementation(() => undefined);

        handleOutsideMouseDown(view, makeOutsideMouseDown(view));

        expect(view.state.selection.main.anchor).toBe(INITIAL_SELECTION);
        expect(getActiveCell(view.state)).toBeNull();
        expect(focus).not.toHaveBeenCalled();
    });

    it('accepts both document boundaries as valid positions', () => {
        const view = mountActiveView();
        const posAtCoords = vi.spyOn(view, 'posAtCoords');
        vi.spyOn(view, 'focus').mockImplementation(() => undefined);

        posAtCoords.mockReturnValueOnce(0);
        handleOutsideMouseDown(view, makeOutsideMouseDown(view));
        expect(view.state.selection.main.anchor).toBe(0);

        activateCell(view);
        posAtCoords.mockReturnValueOnce(DOC.length);
        handleOutsideMouseDown(view, makeOutsideMouseDown(view));
        expect(view.state.selection.main.anchor).toBe(DOC.length);
    });
});
