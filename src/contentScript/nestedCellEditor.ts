import { Annotation, EditorState, StateEffect, StateField, Transaction } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';

export const syncAnnotation = Annotation.define<boolean>();

interface SubviewCellRange {
    from: number;
    to: number;
}

const setSubviewCellRangeEffect = StateEffect.define<SubviewCellRange>();

const subviewCellRangeField = StateField.define<SubviewCellRange>({
    create() {
        return { from: 0, to: 0 };
    },
    update(value, tr) {
        for (const effect of tr.effects) {
            if (effect.is(setSubviewCellRangeEffect)) {
                return effect.value;
            }
        }
        if (tr.docChanged) {
            const mappedFrom = tr.changes.mapPos(value.from, 1);
            const mappedTo = tr.changes.mapPos(value.to, -1);
            return { from: mappedFrom, to: mappedTo };
        }
        return value;
    },
});

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

function createHideOutsideRangeExtension() {
    const hiddenWidget = new HiddenWidget();

    return EditorView.decorations.compute(['doc'], (state) => {
        const { from: cellFrom, to: cellTo } = state.field(subviewCellRangeField);
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
    private mainView: EditorView | null = null;
    private cellFrom: number = 0;
    private cellTo: number = 0;

    open(params: { mainView: EditorView; cellElement: HTMLElement; cellFrom: number; cellTo: number }): void {
        this.close();

        this.mainView = params.mainView;
        this.cellFrom = params.cellFrom;
        this.cellTo = params.cellTo;

        const { content, editorHost } = ensureCellWrapper(params.cellElement);
        this.contentEl = content;
        this.editorHostEl = editorHost;

        content.style.display = 'none';
        editorHost.style.display = '';
        editorHost.textContent = '';

        const forwardChangesToMain = EditorView.updateListener.of((update) => {
            if (!this.mainView) {
                return;
            }

            for (const tr of update.transactions) {
                if (!tr.docChanged) {
                    continue;
                }

                const isSync = Boolean(tr.annotation(syncAnnotation));
                if (isSync) {
                    continue;
                }

                // Keep the local hide-range aligned as edits happen.
                this.cellFrom = tr.changes.mapPos(this.cellFrom, 1);
                this.cellTo = tr.changes.mapPos(this.cellTo, -1);

                // Forward to main editor (source of truth).
                this.mainView.dispatch({
                    changes: tr.changes,
                    annotations: syncAnnotation.of(true),
                });

                // Also update the subview's own range field so decorations stay correct.
                if (this.subview) {
                    this.subview.dispatch({
                        effects: setSubviewCellRangeEffect.of({ from: this.cellFrom, to: this.cellTo }),
                        annotations: syncAnnotation.of(true),
                    });
                }
            }
        });

        const state = EditorState.create({
            doc: params.mainView.state.doc,
            selection: { anchor: params.cellFrom },
            extensions: [
                subviewCellRangeField,
                EditorState.transactionExtender.of((tr) => {
                    // Ensure local transactions don't build history. Main editor owns history.
                    if (tr.annotation(syncAnnotation)) {
                        return null;
                    }
                    return { annotations: Transaction.addToHistory.of(false) };
                }),
                forwardChangesToMain,
                createHideOutsideRangeExtension(),
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

        // Initialize the hide-range state.
        this.subview.dispatch({
            effects: setSubviewCellRangeEffect.of({ from: params.cellFrom, to: params.cellTo }),
            annotations: syncAnnotation.of(true),
        });

        this.subview.focus();
    }

    applyMainTransactions(transactions: readonly Transaction[], cellFrom: number, cellTo: number): void {
        if (!this.subview) {
            return;
        }

        this.cellFrom = cellFrom;
        this.cellTo = cellTo;

        // Keep hide-range aligned to the (mapped) active cell.
        this.subview.dispatch({
            effects: setSubviewCellRangeEffect.of({ from: cellFrom, to: cellTo }),
            annotations: syncAnnotation.of(true),
        });

        for (const tr of transactions) {
            if (!tr.docChanged) {
                continue;
            }
            const isSync = Boolean(tr.annotation(syncAnnotation));
            if (isSync) {
                continue;
            }

            this.subview.dispatch({
                changes: tr.changes,
                annotations: [syncAnnotation.of(true), Transaction.addToHistory.of(false)],
            });
        }
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
        this.mainView = null;
        this.cellFrom = 0;
        this.cellTo = 0;
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

export function applyMainTransactionsToNestedEditor(params: {
    transactions: readonly Transaction[];
    cellFrom: number;
    cellTo: number;
}): void {
    nestedCellEditorManager.applyMainTransactions(params.transactions, params.cellFrom, params.cellTo);
}
