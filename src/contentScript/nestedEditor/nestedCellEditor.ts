import { ChangeSpec, EditorState, Transaction } from '@codemirror/state';
import { drawSelection, EditorView } from '@codemirror/view';
import { renderer } from '../services/markdownRenderer';
import {
    createCellTransactionFilter,
    createHistoryExtender,
    createSubviewCellRangeField,
    setSubviewCellRangeEffect,
    syncAnnotation,
} from './transactionPolicy';
import { ensureCellWrapper, createHideOutsideRangeExtension } from './mounting';
import { createNestedEditorDomHandlers, createNestedEditorKeymap } from './domHandlers';

export { syncAnnotation };

/**
 * Scrolls a cell element into view within only CodeMirror's scroll container.
 * Unlike native scrollIntoView(), this won't affect parent scrollable elements
 * (e.g., Joplin's sidebar layout).
 */
function scrollCellIntoViewWithinEditor(mainView: EditorView, cellElement: HTMLElement): void {
    // Use RAF to ensure layout is stable after editor mount
    requestAnimationFrame(() => {
        const scrollDOM = mainView.scrollDOM;
        const scrollRect = scrollDOM.getBoundingClientRect();
        const cellRect = cellElement.getBoundingClientRect();

        const margin = 8; // Pixels of margin to keep around the cell

        let newScrollTop = scrollDOM.scrollTop;
        let newScrollLeft = scrollDOM.scrollLeft;

        // Vertical scrolling
        if (cellRect.top < scrollRect.top + margin) {
            // Cell is above visible area
            newScrollTop -= (scrollRect.top - cellRect.top) + margin;
        } else if (cellRect.bottom > scrollRect.bottom - margin) {
            // Cell is below visible area
            newScrollTop += (cellRect.bottom - scrollRect.bottom) + margin;
        }

        // Horizontal scrolling
        if (cellRect.left < scrollRect.left + margin) {
            // Cell is to the left of visible area
            newScrollLeft -= (scrollRect.left - cellRect.left) + margin;
        } else if (cellRect.right > scrollRect.right - margin) {
            // Cell is to the right of visible area
            newScrollLeft += (cellRect.right - scrollRect.right) + margin;
        }

        if (newScrollTop !== scrollDOM.scrollTop || newScrollLeft !== scrollDOM.scrollLeft) {
            scrollDOM.scrollTo(newScrollLeft, newScrollTop);
        }
    });
}

/** Manages the lifecycle and state of the nested CodeMirror instance for cell editing. */
class NestedCellEditorManager {
    private subview: EditorView | null = null;
    private contentEl: HTMLElement | null = null;
    private editorHostEl: HTMLElement | null = null;
    private cellElement: HTMLElement | null = null;
    private mainView: EditorView | null = null;
    private cellFrom: number = 0;
    private cellTo: number = 0;

    open(params: {
        mainView: EditorView;
        cellElement: HTMLElement;
        cellFrom: number;
        cellTo: number;
        initialCursorPos?: 'start' | 'end';
    }): void {
        this.close();

        this.mainView = params.mainView;
        this.cellFrom = params.cellFrom;
        this.cellTo = params.cellTo;

        const { content, editorHost } = ensureCellWrapper(params.cellElement);
        this.contentEl = content;
        this.editorHostEl = editorHost;
        this.cellElement = params.cellElement;

        // Add active class to cell for styling
        this.cellElement.classList.add('cm-table-cell-active');

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

        // Determine initial selection anchor
        let initialAnchor = params.cellFrom;
        if (params.initialCursorPos === 'end') {
            initialAnchor = params.cellTo;
        }

        const state = EditorState.create({
            doc: params.mainView.state.doc,
            selection: { anchor: initialAnchor },
            extensions: [
                // Needed for a visible caret in this environment. We intentionally hide
                // CodeMirror's drawn selection layer below (to avoid double-highlighting),
                // which means selection highlight comes from native browser selection.
                drawSelection(),
                rangeField,
                createCellTransactionFilter(rangeField),
                createHistoryExtender(),
                forwardChangesToMain,
                createHideOutsideRangeExtension(rangeField),
                EditorView.lineWrapping,
                createNestedEditorDomHandlers(),
                createNestedEditorKeymap(params.mainView, rangeField),
                EditorView.theme({
                    '&': {
                        backgroundColor: 'transparent',
                    },
                    // Keep drawSelection() enabled (restores a visible caret), but hide its
                    // selection overlay to avoid a second highlight layer. With this disabled,
                    // selection highlight uses the browser's native selection styling.
                    // Unfortunately, using joplin css variables doesn't seem to work here.
                    '.cm-selectionLayer': {
                        display: 'none',
                    },
                    '.cm-scroller': {
                        overflow: 'hidden !important',
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

        // Scroll the cell into view within CodeMirror's scroll container
        scrollCellIntoViewWithinEditor(params.mainView, params.cellElement);

        // Delay focus slightly to prevent race conditions with Android keyboard/scrolling.
        // If we focus immediately on touch, the virtual keyboard animation can conflict
        // with the viewport scroll, causing the editor to jump to the top.
        setTimeout(() => {
            if (this.subview) {
                this.subview.focus();
            }
        }, 100);
    }

    applyMainTransactions(transactions: readonly Transaction[], cellFrom: number, cellTo: number): void {
        if (!this.subview) {
            return;
        }

        this.cellFrom = cellFrom;
        this.cellTo = cellTo;

        // Collect all changes from non-sync transactions.
        const allChanges: ChangeSpec[] = [];
        for (const tr of transactions) {
            if (!tr.docChanged) {
                continue;
            }
            const isSync = Boolean(tr.annotation(syncAnnotation));
            if (isSync) {
                continue;
            }
            allChanges.push(tr.changes);
        }

        // Apply changes and range update in a single transaction.
        // The effect takes precedence over docChanged mapping in rangeField,
        // preventing double-mapping of the already-mapped cellFrom/cellTo.
        this.subview.dispatch({
            changes: allChanges.length > 0 ? allChanges : undefined,
            effects: setSubviewCellRangeEffect.of({ from: cellFrom, to: cellTo }),
            annotations: [syncAnnotation.of(true), Transaction.addToHistory.of(false)],
        });
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

        if (this.cellElement) {
            this.cellElement.classList.remove('cm-table-cell-active');
            this.cellElement = null;
        }

        // Update cell content with current document text before showing.
        if (this.contentEl && this.mainView) {
            const cellText = this.mainView.state.doc.sliceString(this.cellFrom, this.cellTo).trim();

            // Check cache first for rendered HTML.
            const cached = renderer.getCached(cellText);
            if (cached !== undefined) {
                this.contentEl.innerHTML = cached;
            } else {
                // Show raw text immediately, then update when render completes.
                this.contentEl.textContent = cellText;
                const contentEl = this.contentEl;
                renderer.renderAsync(cellText, (html) => {
                    if (contentEl.isConnected) {
                        contentEl.innerHTML = html;
                    }
                });
            }
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

    public checkAndCloseIfHostedIn(container: HTMLElement): void {
        if (this.editorHostEl && container.contains(this.editorHostEl)) {
            this.close();
        }
    }
}

const nestedCellEditorManager = new NestedCellEditorManager();

/** Opens a nested editor for the specified cell. */
export function openNestedCellEditor(params: {
    mainView: EditorView;
    cellElement: HTMLElement;
    cellFrom: number;
    cellTo: number;
    initialCursorPos?: 'start' | 'end';
}): void {
    nestedCellEditorManager.open(params);
}

/** Closes the currently open nested editor, if any. */
export function closeNestedCellEditor(): void {
    nestedCellEditorManager.close();
}

/** Checks if a nested editor is currently open. */
export function isNestedCellEditorOpen(): boolean {
    return nestedCellEditorManager.isOpen();
}

/** Forwards transactions from the main editor to the nested editor to keep them in sync. */
export function applyMainTransactionsToNestedEditor(params: {
    transactions: readonly Transaction[];
    cellFrom: number;
    cellTo: number;
}): void {
    nestedCellEditorManager.applyMainTransactions(params.transactions, params.cellFrom, params.cellTo);
}

/**
 * Checks if the currently open nested editor is hosted within the given container.
 * If so, closes it. Used by parent widgets to clean up on destroy.
 */
export function cleanupHostedEditors(container: HTMLElement): void {
    nestedCellEditorManager.checkAndCloseIfHostedIn(container);
}
