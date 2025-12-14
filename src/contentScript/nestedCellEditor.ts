import { EditorState } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';

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

function createHideOutsideRangeExtension(cellFrom: number, cellTo: number) {
    const hiddenWidget = new HiddenWidget();

    return EditorView.decorations.compute(['doc'], (state) => {
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

function ensureCellWrapper(cell: HTMLElement): { content: HTMLElement; editorHost: HTMLElement } {
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

class NestedCellEditorManager {
    private subview: EditorView | null = null;
    private contentEl: HTMLElement | null = null;
    private editorHostEl: HTMLElement | null = null;

    open(params: { mainView: EditorView; cellElement: HTMLElement; cellFrom: number; cellTo: number }): void {
        this.close();

        const { content, editorHost } = ensureCellWrapper(params.cellElement);
        this.contentEl = content;
        this.editorHostEl = editorHost;

        content.style.display = 'none';
        editorHost.style.display = '';
        editorHost.textContent = '';

        const state = EditorState.create({
            doc: params.mainView.state.doc,
            selection: { anchor: params.cellFrom },
            extensions: [
                createHideOutsideRangeExtension(params.cellFrom, params.cellTo),
                EditorView.theme(
                    {
                        '&': {
                            backgroundColor: 'transparent',
                        },
                        '.cm-scroller': {
                            overflow: 'hidden',
                        },
                        '.cm-content': {
                            padding: '0',
                        },
                    },
                    { dark: false }
                ),
                EditorView.theme(
                    {
                        '&': {
                            backgroundColor: 'transparent',
                        },
                        '.cm-scroller': {
                            overflow: 'hidden',
                        },
                        '.cm-content': {
                            padding: '0',
                        },
                    },
                    { dark: true }
                ),
            ],
        });

        this.subview = new EditorView({
            state,
            parent: editorHost,
        });

        this.subview.focus();
    }

    close(): void {
        if (this.subview) {
            this.subview.destroy();
            this.subview = null;
        }

        if (this.editorHostEl) {
            this.editorHostEl.textContent = '';
            this.editorHostEl.style.display = 'none';
        }

        if (this.contentEl) {
            this.contentEl.style.display = '';
        }

        this.contentEl = null;
        this.editorHostEl = null;
    }

    isOpen(): boolean {
        return this.subview !== null;
    }
}

const nestedCellEditorManager = new NestedCellEditorManager();

export function openNestedCellEditor(params: {
    mainView: EditorView;
    cellElement: HTMLElement;
    cellFrom: number;
    cellTo: number;
}): void {
    nestedCellEditorManager.open(params);
}

export function closeNestedCellEditor(): void {
    nestedCellEditorManager.close();
}

export function isNestedCellEditorOpen(): boolean {
    return nestedCellEditorManager.isOpen();
}
