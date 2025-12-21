import { ensureSyntaxTree, syntaxHighlighting } from '@codemirror/language';
import { ChangeSpec, EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { drawSelection, EditorView } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { inlineCodePlugin, markPlugin, insertPlugin } from './decorationPlugins';
import { joplinHighlightStyle } from './joplinHighlightStyle';
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
import { selectAllInCell } from './markdownCommands';
import { CLASS_CELL_ACTIVE, getWidgetSelector } from '../tableWidget/domConstants';

export { syncAnnotation };

/**
 * Scrolls a cell element into view within only CodeMirror's scroll container.
 * Unlike native scrollIntoView(), this won't affect parent scrollable elements
 * (e.g., Joplin's sidebar layout).
 */
function scrollCellIntoViewWithinEditor(mainView: EditorView, cellElement: HTMLElement): void {
    // Use RAF to ensure layout is stable after editor mount
    requestAnimationFrame(() => {
        // 1. Scroll the main editor to keep the cell in view vertically/horizontally in the main viewport
        const scrollDOM = mainView.scrollDOM;
        const scrollRect = scrollDOM.getBoundingClientRect();
        const cellRect = cellElement.getBoundingClientRect();

        const margin = 8; // Pixels of margin to keep around the cell

        let newScrollTop = scrollDOM.scrollTop;
        let newScrollLeft = scrollDOM.scrollLeft;

        // Vertical scrolling (Main Editor)
        if (cellRect.top < scrollRect.top + margin) {
            newScrollTop -= scrollRect.top - cellRect.top + margin;
        } else if (cellRect.bottom > scrollRect.bottom - margin) {
            newScrollTop += cellRect.bottom - scrollRect.bottom + margin;
        }

        // Horizontal scrolling (Main Editor)
        if (cellRect.left < scrollRect.left + margin) {
            newScrollLeft -= scrollRect.left - cellRect.left + margin;
        } else if (cellRect.right > scrollRect.right - margin) {
            newScrollLeft += cellRect.right - scrollRect.right + margin;
        }

        if (newScrollTop !== scrollDOM.scrollTop || newScrollLeft !== scrollDOM.scrollLeft) {
            scrollDOM.scrollTo(newScrollLeft, newScrollTop);
        }

        // 2. Scroll the table widget itself if it has internal scroll (e.g. on mobile or wide tables)
        const widgetContainer = cellElement.closest(getWidgetSelector()) as HTMLElement;
        if (widgetContainer) {
            const widgetRect = widgetContainer.getBoundingClientRect();
            // We need to re-measure cellRect relative to the widget or just check overlap
            // Note: cellRect from above is still valid relative to viewport.
            // widgetRect is also relative to viewport.

            let newWidgetScrollLeft = widgetContainer.scrollLeft;

            // Check if cell is to the left of the widget's visible area
            if (cellRect.left < widgetRect.left + margin) {
                newWidgetScrollLeft -= widgetRect.left - cellRect.left + margin;
            }
            // Check if cell is to the right of the widget's visible area
            else if (cellRect.right > widgetRect.right - margin) {
                newWidgetScrollLeft += cellRect.right - widgetRect.right + margin;
            }

            if (newWidgetScrollLeft !== widgetContainer.scrollLeft) {
                widgetContainer.scrollTo({ left: newWidgetScrollLeft, behavior: 'auto' });
            }
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
        this.cellElement.classList.add(CLASS_CELL_ACTIVE);

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
                //
                // SCROLL LOCKING STRATEGY:
                // When we type in a cell, the content changes. If the cell content
                // wraps to a new line, the row height increases. CodeMirror observes
                // this DOM size change and might try to adjust the scroll position
                // to keep the "virtual" viewport stable. This often results in jumping.
                //
                // Use CodeMirror's native scrollSnapshot() effect to restore the
                // editor's own scroll position reliably.
                const scrollSnapshotEffect = this.mainView.scrollSnapshot();

                const mainTr = this.mainView.state.update({
                    changes: tr.changes,
                    annotations: syncAnnotation.of(true),
                    scrollIntoView: false,
                });
                this.mainView.dispatch(mainTr);

                const mappedSnapshot = scrollSnapshotEffect.map(mainTr.changes);
                const restoreScroll = () => {
                    if (!this.mainView) {
                        return;
                    }

                    this.mainView.dispatch({
                        effects: mappedSnapshot,
                        annotations: [syncAnnotation.of(true), Transaction.addToHistory.of(false)],
                        scrollIntoView: false,
                    });
                };

                // Restore immediately, then again after layout stabilizes.
                restoreScroll();
                requestAnimationFrame(restoreScroll);

                // Also update the subview's own range field so decorations stay correct.
                if (this.subview) {
                    this.subview.dispatch({
                        effects: setSubviewCellRangeEffect.of({ from: this.cellFrom, to: this.cellTo }),
                        annotations: syncAnnotation.of(true),
                    });
                }
            }
        });

        const forwardSelectionToMain = EditorView.updateListener.of((update) => {
            if (!this.mainView) {
                return;
            }

            if (!update.selectionSet) {
                return;
            }

            // Avoid selection ping-pong for our own mirrored updates.
            const isSync = update.transactions.some((tr) => Boolean(tr.annotation(syncAnnotation)));
            if (isSync) {
                return;
            }

            const nestedSel = update.state.selection.main;
            const mainSel = this.mainView.state.selection.main;

            if (nestedSel.anchor === mainSel.anchor && nestedSel.head === mainSel.head) {
                return;
            }

            // Mirror selection so Joplin's native toolbar/context-sensitive actions,
            // which read the main editor state, operate on the correct range.
            this.mainView.dispatch({
                selection: EditorSelection.single(nestedSel.anchor, nestedSel.head),
                annotations: [syncAnnotation.of(true), Transaction.addToHistory.of(false)],
                scrollIntoView: false,
            });
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
                // Needed for a visible caret. We use drawSelection() but hide its background
                // so we rely on the native browser selection for the highlight (fixing double-highlight)
                // while keeping the CodeMirror-drawn caret.
                drawSelection(),
                rangeField,
                createCellTransactionFilter(rangeField),
                createHistoryExtender(),
                forwardChangesToMain,
                forwardSelectionToMain,
                createHideOutsideRangeExtension(rangeField),
                EditorView.lineWrapping,
                createNestedEditorDomHandlers(params.mainView, rangeField),
                createNestedEditorKeymap(params.mainView, rangeField, {
                    'Mod-a': selectAllInCell(rangeField),
                }),
                markdown({
                    extensions: [GFM], // GFM bundle includes Table, Strikethrough, etc.
                }),
                inlineCodePlugin,
                markPlugin,
                insertPlugin,
                syntaxHighlighting(joplinHighlightStyle, { fallback: true }),
                EditorView.theme({
                    '&': {
                        backgroundColor: 'transparent',
                    },
                    // CodeMirror draws the selection background in a separate layer.
                    // Make the browser's native selection highlight transparent so we don't see
                    // the default blue overlay on top of CodeMirror's highlight.
                    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
                        backgroundColor: 'var(--joplin-selected-color, #6B6B6B) !important',
                    },
                    // NOTE: `::selection` must be attached to an element selector.
                    // Make the native highlight transparent inside the nested editor.
                    // Joplin applies `&.cm-focused ::selection` on the *main* editor, and the
                    // nested editor lives inside the main editor DOM. Use higher specificity
                    // + !important so the browser's default blue overlay never wins here.
                    '&.cm-editor.cm-focused .cm-content::selection, &.cm-editor.cm-focused .cm-content *::selection': {
                        backgroundColor: 'transparent !important',
                        color: 'inherit !important',
                    },
                    '&.cm-editor .cm-content::selection, &.cm-editor .cm-content *::selection': {
                        backgroundColor: 'transparent !important',
                        color: 'inherit !important',
                    },
                    '&.cm-editor.cm-focused .cm-content::-moz-selection, &.cm-editor.cm-focused .cm-content *::-moz-selection':
                        {
                            backgroundColor: 'transparent !important',
                            color: 'inherit !important',
                        },
                    '&.cm-editor .cm-content::-moz-selection, &.cm-editor .cm-content *::-moz-selection': {
                        backgroundColor: 'transparent !important',
                        color: 'inherit !important',
                    },
                    '.cm-scroller': {
                        overflow: 'hidden !important',
                    },
                    '.cm-content': {
                        padding: '0',
                    },
                    '.cm-inline-code': {
                        backgroundColor: 'var(--joplin-code-background-color, rgb(243, 243, 243))',
                        borderRadius: '3px',
                        border: '1px solid var(--joplin-divider-color, #dddddd)',
                        padding: '2px 4px',
                        // border-radius and padding help frame the content nicely including backticks
                    },
                    '.cm-highlighted': {
                        backgroundColor: 'var(--joplin-mark-highlight-background-color, #F7D26E)',
                        color: 'var(--joplin-mark-highlight-color, black)',
                        padding: '1px 2px',
                        borderRadius: '2px',
                    },
                    '.cm-inserted': {
                        textDecoration: 'underline',
                        textDecorationStyle: 'solid',
                    },
                }),
            ],
        });

        // Force the syntax tree to parse synchronously so that syntax highlighting
        // is available immediately on the first paint, preventing a "flicker" of unstyled text.
        // 500ms timeout is plenty for a table cell.
        ensureSyntaxTree(state, state.doc.length, 500);

        this.subview = new EditorView({
            state,
            parent: editorHost,
        });

        // Ensure the main editor selection matches the newly opened nested editor selection.
        // This is important because some Joplin-native commands (like Insert Link) operate
        // on the main editor selection immediately, and re-opening after a table rebuild
        // may not have dispatched a fresh main selection update.
        params.mainView.dispatch({
            selection: EditorSelection.single(initialAnchor, initialAnchor),
            annotations: [syncAnnotation.of(true), Transaction.addToHistory.of(false)],
            scrollIntoView: false,
        });

        // Scroll the cell into view within CodeMirror's scroll container
        scrollCellIntoViewWithinEditor(params.mainView, params.cellElement);

        this.subview.focus();
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

    applyMainSelection(selection: EditorSelection, cellFrom: number, cellTo: number, focus: boolean): void {
        if (!this.subview) {
            return;
        }

        this.cellFrom = cellFrom;
        this.cellTo = cellTo;

        const clamp = (pos: number) => Math.max(cellFrom, Math.min(cellTo, pos));

        // Joplin mostly uses a single-range selection for these commands.
        const mainRange = selection.main;
        const anchor = clamp(mainRange.anchor);
        const head = clamp(mainRange.head);

        const current = this.subview.state.selection.main;
        if (current.anchor === anchor && current.head === head) {
            if (focus) {
                requestAnimationFrame(() => this.subview?.contentDOM.focus({ preventScroll: true }));
            }
            return;
        }

        this.subview.dispatch({
            selection: EditorSelection.single(anchor, head),
            annotations: [syncAnnotation.of(true), Transaction.addToHistory.of(false)],
            scrollIntoView: false,
        });

        if (focus) {
            requestAnimationFrame(() => this.subview?.contentDOM.focus({ preventScroll: true }));
        }
    }

    /**
     * Refocuses the nested editor without triggering scroll.
     * Used to reclaim focus when it's unexpectedly stolen (e.g., by Android focus management).
     */
    refocusWithPreventScroll(): void {
        if (this.subview) {
            this.subview.contentDOM.focus({ preventScroll: true });
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

        if (this.cellElement) {
            this.cellElement.classList.remove(CLASS_CELL_ACTIVE);
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

/** Mirrors the main editor selection into the nested editor (used for Joplin-native commands). */
export function applyMainSelectionToNestedEditor(params: {
    selection: EditorSelection;
    cellFrom: number;
    cellTo: number;
    focus?: boolean;
}): void {
    nestedCellEditorManager.applyMainSelection(params.selection, params.cellFrom, params.cellTo, Boolean(params.focus));
}

/**
 * Checks if the currently open nested editor is hosted within the given container.
 * If so, closes it. Used by parent widgets to clean up on destroy.
 */
export function cleanupHostedEditors(container: HTMLElement): void {
    nestedCellEditorManager.checkAndCloseIfHostedIn(container);
}

/**
 * Refocuses the nested editor without triggering scroll.
 * Used to reclaim focus when it's unexpectedly stolen (e.g., by Android focus management).
 */
export function refocusNestedEditor(): void {
    nestedCellEditorManager.refocusWithPreventScroll();
}
