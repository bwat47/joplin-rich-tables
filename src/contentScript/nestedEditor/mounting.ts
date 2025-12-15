import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { StateField } from '@codemirror/state';
import { SubviewCellRange } from './transactionPolicy';

class HiddenWidget extends WidgetType {
    toDOM(): HTMLElement {
        const span = document.createElement('span');
        span.className = 'cm-table-cell-editor-hidden';
        return span;
    }

    ignoreEvent(): boolean {
        return true;
    }
}

/** Creates a decoration extension that hides all content outside the active cell range. */
export function createHideOutsideRangeExtension(rangeField: StateField<SubviewCellRange>) {
    const hiddenWidget = new HiddenWidget();

    return EditorView.decorations.compute(['doc', rangeField], (state) => {
        const { from: cellFrom, to: cellTo } = state.field(rangeField);
        const ranges: Array<{ from: number; to: number; value: Decoration }> = [];
        const docLen = state.doc.length;

        if (cellFrom > 0) {
            ranges.push({
                from: 0,
                to: cellFrom,
                value: Decoration.replace({ widget: hiddenWidget }),
            });
        }

        if (cellTo < docLen) {
            ranges.push({
                from: cellTo,
                to: docLen,
                value: Decoration.replace({ widget: hiddenWidget }),
            });
        }

        return Decoration.set(ranges.map((r) => r.value.range(r.from, r.to)));
    });
}

/** Ensures the cell element has the required structure (content div and editor host div). */
export function ensureCellWrapper(cell: HTMLElement): { content: HTMLElement; editorHost: HTMLElement } {
    let content = cell.querySelector(':scope > .cm-table-cell-content') as HTMLElement | null;
    if (!content) {
        content = document.createElement('div');
        content.className = 'cm-table-cell-content';

        while (cell.firstChild) {
            content.appendChild(cell.firstChild);
        }
        cell.appendChild(content);
    }

    let editorHost = cell.querySelector(':scope > .cm-table-cell-editor') as HTMLElement | null;
    if (!editorHost) {
        editorHost = document.createElement('div');
        editorHost.className = 'cm-table-cell-editor';
        editorHost.style.display = 'none';
        cell.appendChild(editorHost);
    }

    return { content, editorHost };
}
