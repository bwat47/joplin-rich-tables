import {
    Annotation,
    ChangeSpec,
    EditorSelection,
    EditorState,
    StateEffect,
    StateField,
    Transaction,
} from '@codemirror/state';
import { Decoration, drawSelection, EditorView, WidgetType } from '@codemirror/view';

export const syncAnnotation = Annotation.define<boolean>();

interface SubviewCellRange {
    from: number;
    to: number;
}

const setSubviewCellRangeEffect = StateEffect.define<SubviewCellRange>();

function createSubviewCellRangeField(initial: SubviewCellRange) {
    return StateField.define<SubviewCellRange>({
        create() {
            return initial;
        },
        update(value, tr) {
            for (const effect of tr.effects) {
                if (effect.is(setSubviewCellRangeEffect)) {
                    return effect.value;
                }
            }
            if (tr.docChanged) {
                // Use assoc=-1 for 'from' so insertions at start boundary stay visible.
                const mappedFrom = tr.changes.mapPos(value.from, -1);
                // Use assoc=1 for 'to' so insertions at end boundary stay visible.
                const mappedTo = tr.changes.mapPos(value.to, 1);
                return { from: mappedFrom, to: mappedTo };
            }
            return value;
        },
    });
}

function escapeUnescapedPipes(text: string): string {
    // Escape any '|' that is not already escaped as '\|'.
    // This is intentionally simple and operates on the inserted text only.
    let result = '';
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '|') {
            const prev = i > 0 ? text[i - 1] : '';
            if (prev === '\\') {
                result += '|';
            } else {
                result += '\\|';
            }
        } else {
            result += ch;
        }
    }
    return result;
}

function clamp(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, n));
}

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

function createHideOutsideRangeExtension(rangeField: StateField<SubviewCellRange>) {
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
                // Use assoc=-1 for 'from' so insertions at start boundary stay visible.
                this.cellFrom = tr.changes.mapPos(this.cellFrom, -1);
                // Use assoc=1 for 'to' so insertions at end boundary stay visible.
                this.cellTo = tr.changes.mapPos(this.cellTo, 1);

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

        const rangeField = createSubviewCellRangeField({ from: params.cellFrom, to: params.cellTo });

        const state = EditorState.create({
            doc: params.mainView.state.doc,
            selection: { anchor: params.cellFrom },
            extensions: [
                drawSelection(),
                rangeField,
                EditorState.transactionFilter.of((tr) => {
                    if (!tr.docChanged && !tr.selection) {
                        return tr;
                    }

                    // Allow main->subview sync transactions through untouched.
                    if (tr.annotation(syncAnnotation)) {
                        return tr;
                    }

                    const { from: cellFrom, to: cellTo } = tr.startState.field(rangeField);

                    // Compute new bounds after changes for selection clamping.
                    // The selection in the transaction is the NEW selection, so clamp to NEW bounds.
                    const newCellFrom = tr.docChanged ? tr.changes.mapPos(cellFrom, -1) : cellFrom;
                    const newCellTo = tr.docChanged ? tr.changes.mapPos(cellTo, 1) : cellTo;

                    // Ensure selection stays in-bounds (using new bounds).
                    let selectionSpec: EditorSelection | undefined;
                    if (tr.selection) {
                        const boundedRanges = tr.selection.ranges.map((range) => {
                            const anchor = clamp(range.anchor, newCellFrom, newCellTo);
                            const head = clamp(range.head, newCellFrom, newCellTo);
                            return EditorSelection.range(anchor, head);
                        });
                        selectionSpec = EditorSelection.create(boundedRanges, tr.selection.mainIndex);
                    }

                    if (!tr.docChanged) {
                        // Selection-only transaction.
                        return selectionSpec ? { selection: selectionSpec } : tr;
                    }

                    let rejected = false;
                    let needsPipeEscape = false;
                    const nextChanges: ChangeSpec[] = [];

                    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
                        if (fromA < cellFrom || toA > cellTo) {
                            rejected = true;
                            return;
                        }

                        const insertedText = inserted.toString();
                        if (insertedText.includes('\n') || insertedText.includes('\r')) {
                            rejected = true;
                            return;
                        }

                        const escaped = insertedText.includes('|') ? escapeUnescapedPipes(insertedText) : insertedText;
                        if (escaped !== insertedText) {
                            needsPipeEscape = true;
                        }

                        nextChanges.push({ from: fromA, to: toA, insert: escaped });
                    });

                    if (rejected) {
                        return [];
                    }

                    // If we didn't modify inserts and selection is unchanged, keep transaction.
                    if (!needsPipeEscape && !selectionSpec) {
                        return tr;
                    }

                    return {
                        changes: nextChanges,
                        ...(selectionSpec ? { selection: selectionSpec } : null),
                    };
                }),
                EditorState.transactionExtender.of((tr) => {
                    // Ensure local transactions don't build history. Main editor owns history.
                    if (tr.annotation(syncAnnotation)) {
                        return null;
                    }
                    return { annotations: Transaction.addToHistory.of(false) };
                }),
                forwardChangesToMain,
                createHideOutsideRangeExtension(rangeField),
                EditorView.lineWrapping,
                EditorView.domEventHandlers({
                    keydown: (e) => {
                        // Block modifier key combinations from bubbling to Joplin.
                        // Allow Ctrl+A/C/V/X/Z/Y which work correctly via browser/CodeMirror.
                        const isMod = e.ctrlKey || e.metaKey;
                        if (isMod) {
                            const allowedKeys = ['a', 'c', 'v', 'x', 'z', 'y'];
                            if (!allowedKeys.includes(e.key.toLowerCase())) {
                                e.stopPropagation();
                                e.preventDefault();
                                return true;
                            }
                        }
                        return false;
                    },
                    contextmenu: (e) => {
                        // Prevent all context menus - Joplin's menu doesn't work
                        // in the nested editor, so suppress it entirely.
                        e.stopPropagation();
                        e.preventDefault();
                        return true;
                    },
                }),
                EditorView.theme({
                    '&': {
                        backgroundColor: 'transparent',
                    },
                    '.cm-scroller': {
                        overflow: 'hidden',
                    },
                    '.cm-content': {
                        padding: '0',
                    },
                }),
            ],
        });

        this.subview = new EditorView({
            state,
            parent: editorHost,
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
