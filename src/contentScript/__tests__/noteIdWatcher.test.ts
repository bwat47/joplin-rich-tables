import { markdown } from '@codemirror/lang-markdown';
import { Compartment, Facet, StateField } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNoteIdWatcher } from '../tableRuntime/noteIdWatcher';
import { activeCellField, getActiveCell, setActiveCellEffect } from '../tableState/activeCellState';
import { tableContextField } from '../tableState/tableContextField';

const TABLE = ['| H |', '| --- |', '| body |'].join('\n');

describe('createNoteIdWatcher', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        document.body.innerHTML = '';
    });

    it('observes a note reconfiguration without forcing StateFields to update twice', () => {
        const noteIdFacet = Facet.define<string, string>({
            combine: (values) => values[0] ?? '',
        });
        const noteConfiguration = new Compartment();
        let updateCount = 0;
        const probeField = StateField.define({
            create: () => 0,
            update: (value) => {
                updateCount++;
                return value + 1;
            },
        });
        const parent = document.createElement('div');
        document.body.appendChild(parent);
        let view: EditorView;
        view = new EditorView({
            parent,
            doc: TABLE,
            extensions: [
                markdown({ extensions: [GFM] }),
                tableContextField,
                activeCellField,
                probeField,
                noteConfiguration.of(noteIdFacet.of('note-a')),
                createNoteIdWatcher(noteIdFacet, () => view),
            ],
        });
        view.dispatch({
            selection: { anchor: TABLE.indexOf('body') },
            effects: setActiveCellEffect.of({ tableFrom: 0, section: 'body', row: 0, col: 0 }),
        });
        updateCount = 0;

        view.dispatch({ effects: noteConfiguration.reconfigure(noteIdFacet.of('note-b')) });

        expect(updateCount).toBe(1);
        vi.runAllTimers();
        expect(getActiveCell(view.state)).toBeNull();
        view.destroy();
    });
});
