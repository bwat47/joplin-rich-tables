import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView, type BlockInfo } from '@codemirror/view';
import { activeCellField, getActiveCell, setActiveCellEffect } from '../tableState/activeCellState';
import { handleOutsideMouseDown } from '../tableRuntime/interaction/outsideTableInteraction';

const DOC = 'above\nbelow';
const INITIAL_SELECTION = 2;
const VALID_CLICK_POSITION = 8;
const SECOND_LINE_START = 6;

const mountedViews: EditorView[] = [];

function mountActiveView(): EditorView {
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const view = new EditorView({
        parent,
        doc: DOC,
        selection: { anchor: INITIAL_SELECTION },
        extensions: [activeCellField],
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

/** Stands in for the height map, which reports a line start rather than an exact column. */
function stubHeightMap(view: EditorView, from: number): void {
    vi.spyOn(view, 'lineBlockAtHeight').mockReturnValue({ from } as BlockInfo);
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
        const lineBlockAtHeight = vi.spyOn(view, 'lineBlockAtHeight');
        const focus = vi.spyOn(view, 'focus').mockImplementation(() => undefined);

        const handled = handleOutsideMouseDown(view, makeOutsideMouseDown(view));

        expect(handled).toBe(true);
        expect(view.state.selection.main.anchor).toBe(VALID_CLICK_POSITION);
        expect(getActiveCell(view.state)).toBeNull();
        expect(focus).toHaveBeenCalledOnce();
        expect(lineBlockAtHeight).not.toHaveBeenCalled();
    });

    it.each([
        ['null', null],
        ['undefined', undefined],
        ['NaN', Number.NaN],
        ['negative', -1],
        ['fractional', 1.5],
        ['past the document end', DOC.length + 1],
    ])('falls back to the height map when coordinate mapping returns %s', (_label, mappedPos) => {
        const view = mountActiveView();
        vi.spyOn(view, 'posAtCoords').mockReturnValue(mappedPos as never);
        stubHeightMap(view, SECOND_LINE_START);
        const focus = vi.spyOn(view, 'focus').mockImplementation(() => undefined);

        const handled = handleOutsideMouseDown(view, makeOutsideMouseDown(view));

        // Consuming the event keeps CodeMirror's own handler from repeating the failed
        // mapping and dispatching its unusable result.
        expect(handled).toBe(true);
        expect(view.state.selection.main.anchor).toBe(SECOND_LINE_START);
        expect(getActiveCell(view.state)).toBeNull();
        expect(focus).toHaveBeenCalledOnce();
    });

    it('leaves the caret alone when the height map cannot place the pointer either', () => {
        const view = mountActiveView();
        vi.spyOn(view, 'posAtCoords').mockReturnValue(undefined as never);
        stubHeightMap(view, Number.NaN);
        const focus = vi.spyOn(view, 'focus').mockImplementation(() => undefined);

        const handled = handleOutsideMouseDown(view, makeOutsideMouseDown(view));

        expect(handled).toBe(false);
        expect(view.state.selection.main.anchor).toBe(INITIAL_SELECTION);
        expect(getActiveCell(view.state)).toBeNull();
        expect(focus).not.toHaveBeenCalled();
    });

    it('accepts both document boundaries as valid positions', () => {
        const view = mountActiveView();
        const posAtCoords = vi.spyOn(view, 'posAtCoords');
        vi.spyOn(view, 'focus').mockImplementation(() => undefined);

        posAtCoords.mockReturnValueOnce(0);
        expect(handleOutsideMouseDown(view, makeOutsideMouseDown(view))).toBe(true);
        expect(view.state.selection.main.anchor).toBe(0);

        activateCell(view);
        posAtCoords.mockReturnValueOnce(DOC.length);
        expect(handleOutsideMouseDown(view, makeOutsideMouseDown(view))).toBe(true);
        expect(view.state.selection.main.anchor).toBe(DOC.length);
    });
});
