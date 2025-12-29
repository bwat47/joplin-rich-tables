import { ensureSyntaxTree } from '@codemirror/language';
import { ChangeSpec, EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { drawSelection, EditorView, ViewPlugin } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { inlineCodePlugin, markPlugin, insertPlugin } from './decorationPlugins';
import { createJoplinSyntaxHighlighting } from './joplinHighlightStyle';
import { createNestedEditorTheme } from './nestedEditorTheme';
import { renderer } from '../services/markdownRenderer';
import { documentDefinitionsField } from '../services/documentDefinitions';
import { buildRenderableContent } from '../shared/cellContentUtils';
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
import { CLASS_CELL_ACTIVE } from '../tableWidget/domHelpers';

const SYNTAX_TREE_PARSE_TIMEOUT = 500;

export { syncAnnotation };

/**
 * Scrolls a cell element into view within only CodeMirror's scroll container.
 * Uses CodeMirror's requestMeasure to defer scrolling until after layout is stable,
 * ensuring height changes from closing the previous cell have propagated.
 */
function scrollCellIntoViewWithinEditor(mainView: EditorView, cellElement: HTMLElement): void {
    // Defer scrolling until after CodeMirror's next measurement phase.
    // This ensures height changes from closing the previous cell (e.g., when
    // markdown-heavy content switches from raw text to rendered HTML) have
    // propagated and the viewport positions are accurate.
    mainView.requestMeasure({
        read: () => cellElement.isConnected,
        write: (isConnected) => {
            if (isConnected) {
                cellElement.scrollIntoView({
                    block: 'nearest',
                    inline: 'nearest',
                });
            }
        },
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
        this.cellElement = params.cellElement;

        // Lock cell width before switching to edit mode to prevent horizontal
        // expansion when raw markdown (e.g., long URLs) is shown instead of
        // rendered content. Height will still adjust as text wraps.
        // Use max-width (not just width) because table cells treat width as a minimum.
        const cellWidth = this.cellElement.offsetWidth;
        this.cellElement.style.maxWidth = `${cellWidth}px`;

        const { content, editorHost } = ensureCellWrapper(params.cellElement);
        this.contentEl = content;
        this.editorHostEl = editorHost;

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
                const nestedSel = update.state.selection.main;

                this.mainView.dispatch({
                    changes: tr.changes,
                    selection: EditorSelection.single(nestedSel.anchor, nestedSel.head),
                    annotations: syncAnnotation.of(true),
                    scrollIntoView: false,
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

        // Detect if Joplin is using a dark theme to select matching syntax colors
        const isDarkTheme = params.mainView.state.facet(EditorView.darkTheme);

        const state = EditorState.create({
            doc: params.mainView.state.doc,
            selection: { anchor: initialAnchor },
            extensions: [
                // Needed for a visible caret.
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
                createJoplinSyntaxHighlighting(isDarkTheme),
                createNestedEditorTheme(isDarkTheme),
            ],
        });

        // Force the syntax tree to parse synchronously so that syntax highlighting
        // is available immediately on the first paint, preventing a "flicker" of unstyled text.
        ensureSyntaxTree(state, state.doc.length, SYNTAX_TREE_PARSE_TIMEOUT);

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
            // Remove the width lock set during open()
            this.cellElement.style.maxWidth = '';
            this.cellElement = null;
        }

        // Update cell content with current document text before showing.
        if (this.contentEl && this.mainView) {
            const cellText = this.mainView.state.doc.sliceString(this.cellFrom, this.cellTo).trim();
            const definitions = this.mainView.state.field(documentDefinitionsField);
            const { displayText, cacheKey } = buildRenderableContent(cellText, definitions.definitionBlock);

            // Check cache first for rendered HTML.
            const cached = renderer.getCached(cacheKey);
            if (cached !== undefined) {
                this.contentEl.innerHTML = cached;
            } else {
                // Show raw text immediately, then update when render completes.
                this.contentEl.textContent = displayText;
                const contentEl = this.contentEl;
                renderer.renderAsync(cacheKey, (html) => {
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

/**
 * ViewPlugin that manages the NestedCellEditorManager lifecycle.
 * This attaches the manager to the EditorView instance rather than using a global singleton.
 */
export const nestedCellEditorPlugin = ViewPlugin.fromClass(
    class {
        manager: NestedCellEditorManager;

        constructor(_view: EditorView) {
            this.manager = new NestedCellEditorManager();
        }

        destroy() {
            this.manager.close();
        }
    }
);

/** Retrieves the NestedCellEditorManager for the given view. */
function getManager(view: EditorView): NestedCellEditorManager | null {
    const plugin = view.plugin(nestedCellEditorPlugin);
    return plugin ? plugin.manager : null;
}

/** Opens a nested editor for the specified cell. */
export function openNestedCellEditor(params: {
    mainView: EditorView;
    cellElement: HTMLElement;
    cellFrom: number;
    cellTo: number;
    initialCursorPos?: 'start' | 'end';
}): void {
    getManager(params.mainView)?.open(params);
}

/** Closes the currently open nested editor, if any. */
export function closeNestedCellEditor(view: EditorView): void {
    getManager(view)?.close();
}

/** Checks if a nested editor is currently open. */
export function isNestedCellEditorOpen(view: EditorView): boolean {
    return getManager(view)?.isOpen() ?? false;
}

/** Forwards transactions from the main editor to the nested editor to keep them in sync. */
export function applyMainTransactionsToNestedEditor(
    view: EditorView,
    params: {
        transactions: readonly Transaction[];
        cellFrom: number;
        cellTo: number;
    }
): void {
    getManager(view)?.applyMainTransactions(params.transactions, params.cellFrom, params.cellTo);
}

/** Mirrors the main editor selection into the nested editor (used for Joplin-native commands). */
export function applyMainSelectionToNestedEditor(
    view: EditorView,
    params: {
        selection: EditorSelection;
        cellFrom: number;
        cellTo: number;
        focus?: boolean;
    }
): void {
    getManager(view)?.applyMainSelection(params.selection, params.cellFrom, params.cellTo, Boolean(params.focus));
}

/**
 * Checks if the currently open nested editor is hosted within the given container.
 * If so, closes it. Used by parent widgets to clean up on destroy.
 */
export function cleanupHostedEditors(view: EditorView, container: HTMLElement): void {
    getManager(view)?.checkAndCloseIfHostedIn(container);
}

/**
 * Refocuses the nested editor without triggering scroll.
 * Used to reclaim focus when it's unexpectedly stolen (e.g., by Android focus management).
 */
export function refocusNestedEditor(view: EditorView): void {
    getManager(view)?.refocusWithPreventScroll();
}
