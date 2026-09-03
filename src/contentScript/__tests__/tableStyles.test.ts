/** @vitest-environment jsdom */

import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultHostEditorConfig } from '../../contentScriptBridge/hostEditorConfigBridge';
import { hostEditorConfigFacet } from '../services/hostEditorConfig';
import { CLASS_TABLE_WIDGET_TABLE } from '../tableWidget/domHelpers';
import { ATTR_ZEBRA_STRIPING, tableStyles } from '../tableWidget/tableStyles';

const mountedViews: EditorView[] = [];

function mountView(zebraStriping: boolean): EditorView {
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
        ],
    });
    mountedViews.push(view);

    return view;
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
        const view = mountView(true);
        const table = document.createElement('table');
        table.className = CLASS_TABLE_WIDGET_TABLE;
        table.innerHTML = '<tbody><tr><td>1</td></tr><tr><td>2</td></tr><tr><td>3</td></tr></tbody>';
        view.contentDOM.appendChild(table);
        const cells = table.querySelectorAll('td');

        expect(getComputedStyle(cells[0]).backgroundColor).not.toBe('var(--rt-stripe-bg)');
        expect(getComputedStyle(cells[1]).backgroundColor).toBe('var(--rt-stripe-bg)');
        expect(getComputedStyle(cells[2]).backgroundColor).not.toBe('var(--rt-stripe-bg)');
    });
});
