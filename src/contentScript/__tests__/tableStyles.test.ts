/** @vitest-environment jsdom */

import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultHostEditorConfig } from '../../contentScriptBridge/hostEditorConfigBridge';
import { hostEditorConfigFacet } from '../services/hostEditorConfig';
import { cellSelectionVisuals } from '../tableWidget/cellSelectionVisuals';
import { CLASS_CELL_SELECTED, CLASS_TABLE_WIDGET_TABLE } from '../tableWidget/domHelpers';
import { ATTR_ZEBRA_STRIPING, tableStyles } from '../tableWidget/tableStyles';

const mountedViews: EditorView[] = [];

function mountView(zebraStriping: boolean, extraExtensions: Extension = []): EditorView {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const defaults = defaultHostEditorConfig();
    const view = new EditorView({
        parent,
        extensions: [
            hostEditorConfigFacet.of({
                ...defaults,
                tableAppearance: { zebraStriping },
            }),
            tableStyles,
            extraExtensions,
        ],
    });
    mountedViews.push(view);

    return view;
}

/** Appends a single-column widget table, one body row per entry, and returns its cells. */
function appendTable(view: EditorView, rows: { selected?: boolean }[]): NodeListOf<HTMLTableCellElement> {
    const table = document.createElement('table');
    table.className = CLASS_TABLE_WIDGET_TABLE;
    const tbody = document.createElement('tbody');

    for (const [index, row] of rows.entries()) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        if (row.selected) {
            td.classList.add(CLASS_CELL_SELECTED);
        }
        td.textContent = String(index + 1);
        tr.appendChild(td);
        tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    view.contentDOM.appendChild(table);

    return table.querySelectorAll('td');
}

afterEach(() => {
    while (mountedViews.length > 0) {
        mountedViews.pop()?.destroy();
    }
    document.body.replaceChildren();
});

describe('tableStyles', () => {
    it('does not mark the editor for zebra striping by default', () => {
        const view = mountView(false);

        expect(view.dom.hasAttribute(ATTR_ZEBRA_STRIPING)).toBe(false);
    });

    it('marks the editor when zebra striping is enabled', () => {
        const view = mountView(true);

        expect(view.dom.hasAttribute(ATTR_ZEBRA_STRIPING)).toBe(true);
    });

    it('shades only even body rows when enabled', () => {
        const cells = appendTable(mountView(true), [{}, {}, {}]);

        expect(getComputedStyle(cells[0]).backgroundColor).not.toBe('var(--rt-stripe-bg)');
        expect(getComputedStyle(cells[1]).backgroundColor).toBe('var(--rt-stripe-bg)');
        expect(getComputedStyle(cells[2]).backgroundColor).not.toBe('var(--rt-stripe-bg)');
    });

    it('leaves a selected cell on the selection ground rather than a stripe', () => {
        const cells = appendTable(mountView(true, cellSelectionVisuals), [{}, { selected: true }, {}, {}]);

        expect(getComputedStyle(cells[1]).backgroundColor).toBe('var(--rt-selection-ground-bg)');
        expect(getComputedStyle(cells[3]).backgroundColor).toBe('var(--rt-stripe-bg)');
    });
});
