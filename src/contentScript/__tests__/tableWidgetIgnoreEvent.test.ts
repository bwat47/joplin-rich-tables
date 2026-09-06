/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from 'vitest';
import { MarkdownTable } from '../tableModel/MarkdownTable';
import { TableWidget } from '../tableWidget/TableWidget';
import { CLASS_CELL_CONTENT } from '../shared/tableDomClasses';
import { CLASS_TABLE_WIDGET } from '../tableWidget/domHelpers';
import { parseCellRangesFixture } from './testUtils';

const DOC = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');

function createWidget(): TableWidget {
    const table = MarkdownTable.parse(DOC);
    if (!table) {
        throw new Error('Expected the test table to parse');
    }

    return new TableWidget(table, parseCellRangesFixture(DOC), DOC, 0);
}

/**
 * The parts of a rendered table the copy rules care about: content inside a cell, the widget
 * around it, and a line of the document after it.
 */
function mountEditorContent(): { cellText: Text; widget: HTMLElement; afterTable: Text } {
    document.body.innerHTML = `
        <div class="cm-content">
            <div class="${CLASS_TABLE_WIDGET}">
                <table><tbody><tr><td><div class="${CLASS_CELL_CONTENT}">hello</div></td></tr></tbody></table>
            </div>
            <div class="cm-line">after the table</div>
        </div>`;

    return {
        cellText: document.querySelector(`.${CLASS_CELL_CONTENT}`)?.firstChild as Text,
        widget: document.querySelector(`.${CLASS_TABLE_WIDGET}`) as HTMLElement,
        afterTable: document.querySelector('.cm-line')?.firstChild as Text,
    };
}

function copyEventFrom(target: Node): Event {
    return { type: 'copy', target } as unknown as Event;
}

function select(anchorNode: Node, anchorOffset: number, focusNode: Node, focusOffset: number): void {
    document.getSelection()?.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
}

describe('TableWidget.ignoreEvent', () => {
    afterEach(() => {
        document.getSelection()?.removeAllRanges();
        document.body.replaceChildren();
    });

    it('disowns a selection change, which belongs to the pending cell gesture', () => {
        expect(createWidget().ignoreEvent({ type: 'selectionchange' } as Event)).toBe(true);
    });

    it('disowns a copy of text the browser selected inside a rendered cell', () => {
        // Otherwise CodeMirror answers the copy from its own document selection, which is
        // empty during a long press, and copies the caret's whole source line instead.
        const { cellText } = mountEditorContent();
        select(cellText, 1, cellText, 4);

        expect(createWidget().ignoreEvent(copyEventFrom(cellText))).toBe(true);
    });

    it('keeps a copy of a whole-table selection, whose Markdown the main editor owns', () => {
        const { widget, afterTable } = mountEditorContent();
        const content = widget.parentElement as HTMLElement;
        select(content, 0, afterTable, 0);

        expect(createWidget().ignoreEvent(copyEventFrom(content))).toBe(false);
    });

    it('keeps a copy whose selection only starts in a rendered cell', () => {
        const { cellText, afterTable } = mountEditorContent();
        select(cellText, 1, afterTable, 5);

        expect(createWidget().ignoreEvent(copyEventFrom(cellText))).toBe(false);
    });

    it('keeps a copy with nothing selected, which is the caret the main editor parked', () => {
        const { cellText } = mountEditorContent();
        select(cellText, 2, cellText, 2);

        expect(createWidget().ignoreEvent(copyEventFrom(cellText))).toBe(false);
    });

    it('keeps every other event, including a cut a rendered cell cannot serve', () => {
        const { cellText } = mountEditorContent();
        select(cellText, 1, cellText, 4);

        expect(createWidget().ignoreEvent({ type: 'cut', target: cellText } as unknown as Event)).toBe(false);
        expect(createWidget().ignoreEvent({ type: 'mousedown', target: cellText } as unknown as Event)).toBe(false);
    });
});
