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

/**
 * Renders a single-column widget table, one body row per entry, and returns the background each
 * row's cell resolves to.
 *
 * These backgrounds name theme variables whose colours come from the host, and jsdom does not
 * substitute custom properties, so the tests below compare rows against each other rather than
 * against any particular colour.
 */
function renderRowBackgrounds(view: EditorView, rows: { selected?: boolean }[]): string[] {
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

    return Array.from(table.querySelectorAll('td'), (cell) => getComputedStyle(cell).backgroundColor);
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

    it('leaves every body row alike when disabled', () => {
        const [first, second, third] = renderRowBackgrounds(mountView(false), [{}, {}, {}]);

        expect(second).toBe(first);
        expect(third).toBe(first);
    });

    it('shades only even body rows when enabled', () => {
        const rows = [{}, {}, {}, {}];
        const plain = renderRowBackgrounds(mountView(false), rows);
        const striped = renderRowBackgrounds(mountView(true), rows);

        const shaded = striped.map((background, index) => background !== plain[index]);

        expect(shaded).toEqual([false, true, false, true]);
    });

    it('paints a selected cell alike whether or not its row is striped', () => {
        const [plain, selectedEven, selectedOdd, striped] = renderRowBackgrounds(
            mountView(true, cellSelectionVisuals),
            [{}, { selected: true }, { selected: true }, {}]
        );

        expect(selectedEven).toBe(selectedOdd);
        expect(selectedEven).not.toBe(striped);
        // The exclusion that keeps the two alike must not have stopped striping altogether.
        expect(striped).not.toBe(plain);
    });
});
