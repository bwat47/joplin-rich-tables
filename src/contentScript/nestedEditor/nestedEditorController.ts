import { markdown } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { drawSelection, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import { inlineCodePlugin, insertPlugin, markPlugin } from './decorationPlugins';
import { createNestedEditorDomHandlers, createNestedEditorKeymap, mirrorLocalSelectionToMain } from './domHandlers';
import { createJoplinSyntaxHighlighting } from './joplinHighlightStyle';
import { selectAllInCell } from './markdownCommands';
import { createNestedEditorTheme } from './nestedEditorTheme';
import {
    LocalSelection,
    sanitizeLocalText,
    toLocalSelection,
    toRootSelection,
    unsanitizeRootText,
} from '../editorBridge/cellTextCodec';
import { syncAnnotation } from '../editorBridge/syncAnnotation';
import { consumePendingNavigationCallback } from '../tableRuntime/navigationLock';
import { ensureCellWrapper } from './mounting';
import { resolveActiveCell } from '../tableRuntime/activeCell/activeCellResolver';
import { clearActiveCellEffect, getActiveCell, type ActiveCell } from '../tableState/activeCellState';
import { buildRenderableContent, containsMarkdown, escapeHtmlPreservingBr } from '../shared/cellContentUtils';
import { CLASS_CELL_ACTIVE } from '../shared/tableDomClasses';
import { documentDefinitionsField } from '../services/documentDefinitions';
import { renderer } from '../services/markdownRenderer';

const SYNTAX_TREE_PARSE_TIMEOUT = 500;

export interface NestedEditorCellRange {
    tableFrom: number;
    tableTo: number;
    cellFrom: number;
    cellTo: number;
}

export interface NestedEditorLocalState {
    text: string;
    selection: LocalSelection;
}

export interface NestedEditorRootState {
    text: string;
    selection: LocalSelection;
}

export interface NestedEditorSession {
    activeCell: ActiveCell;
    range: NestedEditorCellRange;
    local: NestedEditorLocalState;
    root: NestedEditorRootState;
    editor: EditorView | null;
    applyingRootToLocal: boolean;
}

function scrollCellIntoViewWithinEditor(mainView: EditorView, cellElement: HTMLElement): void {
    mainView.requestMeasure({
        read: () => cellElement.isConnected,
        write: (isConnected) => {
            if (isConnected) {
                cellElement.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }
        },
    });
}

function toAbsoluteSelection(selection: LocalSelection, cellFrom: number): LocalSelection {
    return {
        anchor: cellFrom + selection.anchor,
        head: cellFrom + selection.head,
    };
}

function toRelativeSelection(selection: EditorSelection, cellFrom: number, cellTo: number): LocalSelection {
    const main = selection.main;
    const clamp = (pos: number) => Math.max(cellFrom, Math.min(cellTo, pos));
    return {
        anchor: clamp(main.anchor) - cellFrom,
        head: clamp(main.head) - cellFrom,
    };
}

function areSelectionsEqual(a: LocalSelection, b: LocalSelection): boolean {
    return a.anchor === b.anchor && a.head === b.head;
}

function isEditorFocused(view: EditorView | null): boolean {
    return Boolean(view?.hasFocus);
}

class NestedEditorController {
    private session: NestedEditorSession | null = null;
    private contentEl: HTMLElement | null = null;
    private editorHostEl: HTMLElement | null = null;
    private cellElement: HTMLElement | null = null;
    private mainView: EditorView | null = null;

    open(params: {
        mainView: EditorView;
        cellElement: HTMLElement;
        activeCell: ActiveCell;
        initialCursorPos?: 'start' | 'end' | 'lastLineStart';
        onFocused?: () => void;
    }): void {
        this.close();

        const resolved = resolveActiveCell(params.mainView.state, params.activeCell);
        if (!resolved) {
            return;
        }

        this.mainView = params.mainView;
        this.cellElement = params.cellElement;

        const { content, editorHost } = ensureCellWrapper(params.cellElement);
        this.contentEl = content;
        this.editorHostEl = editorHost;

        this.cellElement.classList.add(CLASS_CELL_ACTIVE);
        editorHost.textContent = '';

        const rootText = params.mainView.state.doc.sliceString(resolved.cellFrom, resolved.cellTo);
        const localText = unsanitizeRootText(rootText);
        const rootSelection = toRelativeSelection(params.mainView.state.selection, resolved.cellFrom, resolved.cellTo);
        let localSelection = toLocalSelection(rootSelection, rootText);

        if (params.initialCursorPos === 'start') {
            localSelection = { anchor: 0, head: 0 };
        } else if (params.initialCursorPos === 'end') {
            localSelection = { anchor: localText.length, head: localText.length };
        } else if (params.initialCursorPos === 'lastLineStart') {
            const lastNewline = localText.lastIndexOf('\n');
            const pos = lastNewline === -1 ? 0 : lastNewline + 1;
            localSelection = { anchor: pos, head: pos };
        }

        const session: NestedEditorSession = {
            activeCell: resolved.activeCell,
            range: {
                tableFrom: resolved.tableFrom,
                tableTo: resolved.tableTo,
                cellFrom: resolved.cellFrom,
                cellTo: resolved.cellTo,
            },
            local: { text: localText, selection: localSelection },
            root: { text: rootText, selection: rootSelection },
            editor: null,
            applyingRootToLocal: false,
        };

        const isDarkTheme = params.mainView.state.facet(EditorView.darkTheme);
        const state = EditorState.create({
            doc: localText,
            selection: EditorSelection.single(localSelection.anchor, localSelection.head),
            extensions: [
                drawSelection(),
                EditorView.lineWrapping,
                EditorView.contentAttributes.of({
                    autocapitalize: 'sentences',
                }),
                EditorState.transactionExtender.of((tr) => {
                    if (tr.annotation(syncAnnotation)) {
                        return null;
                    }
                    return { annotations: Transaction.addToHistory.of(false) };
                }),
                EditorView.updateListener.of((update) => this.handleLocalUpdate(update)),
                createNestedEditorDomHandlers(params.mainView, {
                    syncSelectionToMain: (view, event) => this.syncSelectionToMain(view, event),
                    closeEditor: () => this.close(),
                    ensureRootSelectionForCommand: () => this.flushSelectionToRoot(),
                }),
                createNestedEditorKeymap(params.mainView, {
                    getSelectionBounds: (view) => ({ from: 0, to: view.state.doc.length }),
                    closeEditor: () => this.close(),
                    extraBindings: {
                        'Mod-a': selectAllInCell(),
                    },
                }),
                markdown({
                    extensions: [GFM],
                    addKeymap: false,
                }),
                inlineCodePlugin,
                markPlugin,
                insertPlugin,
                createJoplinSyntaxHighlighting(isDarkTheme),
                createNestedEditorTheme(isDarkTheme),
            ],
        });

        ensureSyntaxTree(state, state.doc.length, SYNTAX_TREE_PARSE_TIMEOUT);

        session.editor = new EditorView({
            state,
            parent: editorHost,
        });
        this.session = session;

        this.flushSelectionToRoot();
        scrollCellIntoViewWithinEditor(params.mainView, params.cellElement);
        session.editor.contentDOM.focus({ preventScroll: true });

        requestAnimationFrame(() => {
            params.onFocused?.();
            consumePendingNavigationCallback()?.();
        });
    }

    handleMainEditorUpdate(update: ViewUpdate): void {
        if (!this.session || !this.mainView) {
            return;
        }

        if (!update.docChanged && !update.selectionSet) {
            return;
        }

        const stateActiveCell = getActiveCell(update.state);
        if (stateActiveCell) {
            this.session.activeCell = stateActiveCell;
        }

        const resolved = resolveActiveCell(update.state, this.session.activeCell);
        if (!resolved) {
            const mainView = this.mainView;
            this.close();
            if (mainView && getActiveCell(update.state)) {
                mainView.dispatch({ effects: clearActiveCellEffect.of(undefined) });
            }
            return;
        }

        this.session.activeCell = resolved.activeCell;
        this.session.range = {
            tableFrom: resolved.tableFrom,
            tableTo: resolved.tableTo,
            cellFrom: resolved.cellFrom,
            cellTo: resolved.cellTo,
        };

        const rootText = update.state.doc.sliceString(resolved.cellFrom, resolved.cellTo);
        const rootSelection = toRelativeSelection(update.state.selection, resolved.cellFrom, resolved.cellTo);

        this.session.root = {
            text: rootText,
            selection: rootSelection,
        };

        this.rebaseLocalEditorFromRoot();
    }

    close(params?: { cellFrom?: number; cellTo?: number }): void {
        const session = this.session;
        const mainView = this.mainView;

        if (session?.editor) {
            session.editor.destroy();
        }

        if (this.editorHostEl) {
            this.editorHostEl.textContent = '';
        }

        if (this.cellElement) {
            this.cellElement.classList.remove(CLASS_CELL_ACTIVE);
        }

        const { cellFrom, cellTo } = this.resolveCellRangeForClose(params, session, mainView);

        if (this.contentEl && mainView) {
            const cellText = mainView.state.doc.sliceString(cellFrom, cellTo).trim();
            const definitions = mainView.state.field(documentDefinitionsField);
            const { displayText, cacheKey } = buildRenderableContent(cellText, definitions.definitionBlock);
            const cached = renderer.getCached(cacheKey);

            if (cached !== undefined) {
                this.contentEl.innerHTML = cached;
            } else {
                this.contentEl.innerHTML = escapeHtmlPreservingBr(displayText);
                if (containsMarkdown(displayText)) {
                    const contentEl = this.contentEl;
                    renderer.renderAsync(cacheKey, (html) => {
                        if (contentEl.isConnected) {
                            contentEl.innerHTML = html;
                        }
                    });
                }
            }
        }

        this.session = null;
        this.contentEl = null;
        this.editorHostEl = null;
        this.cellElement = null;
        this.mainView = null;
    }

    /**
     * Resolve cell range for close(), preferring freshly-resolved positions over
     * cached session positions. After undo/redo, the cached session.range may
     * point to stale document positions (the document shifted but session.range
     * was not remapped), causing close() to read the wrong cell text.
     *
     * Re-resolves the cell using the session's own identity and cached table
     * position against the current editor state. This stays anchored to the
     * session's table (avoiding cross-table misreads when open() closes a
     * previous session after activating a cell in a different table) while
     * picking up any position shifts from undo/redo.
     */
    private resolveCellRangeForClose(
        params: { cellFrom?: number; cellTo?: number } | undefined,
        session: NestedEditorSession | null,
        mainView: EditorView | null
    ): { cellFrom: number; cellTo: number } {
        if (params?.cellFrom != null && params?.cellTo != null) {
            return { cellFrom: params.cellFrom, cellTo: params.cellTo };
        }

        if (session && mainView) {
            const resolved = resolveActiveCell(mainView.state, session.activeCell);
            if (resolved) {
                return { cellFrom: resolved.cellFrom, cellTo: resolved.cellTo };
            }
        }

        return {
            cellFrom: session?.range.cellFrom ?? 0,
            cellTo: session?.range.cellTo ?? 0,
        };
    }

    isOpen(): boolean {
        return Boolean(this.session?.editor);
    }

    refocusWithPreventScroll(): void {
        this.session?.editor?.contentDOM.focus({ preventScroll: true });
    }

    checkAndCloseIfHostedIn(container: HTMLElement): void {
        if (this.editorHostEl && container.contains(this.editorHostEl)) {
            this.close();
        }
    }

    private handleLocalUpdate(update: ViewUpdate): void {
        if (!this.session || !this.mainView) {
            return;
        }

        const isSync = update.transactions.some((tr) => Boolean(tr.annotation(syncAnnotation)));
        if (isSync || this.session.applyingRootToLocal) {
            return;
        }

        const localSelection = {
            anchor: update.state.selection.main.anchor,
            head: update.state.selection.main.head,
        };
        const localText = update.state.doc.toString();
        this.session.local = { text: localText, selection: localSelection };

        if (update.docChanged) {
            this.forwardLocalStateToRoot(true);
        } else if (update.selectionSet) {
            this.flushSelectionToRoot();
        }
    }

    private forwardLocalStateToRoot(includeChanges: boolean): void {
        if (!this.session || !this.mainView) {
            return;
        }

        const rootText = sanitizeLocalText(this.session.local.text);
        const rootSelection = toRootSelection(this.session.local.selection, this.session.local.text);
        const absoluteSelection = toAbsoluteSelection(rootSelection, this.session.range.cellFrom);
        const currentMainSelection = this.mainView.state.selection.main;

        const textChanged = rootText !== this.session.root.text;
        const selectionChanged =
            currentMainSelection.anchor !== absoluteSelection.anchor ||
            currentMainSelection.head !== absoluteSelection.head;

        if ((!includeChanges || !textChanged) && !selectionChanged) {
            return;
        }

        this.mainView.dispatch({
            changes:
                includeChanges && textChanged
                    ? {
                          from: this.session.range.cellFrom,
                          to: this.session.range.cellTo,
                          insert: rootText,
                      }
                    : undefined,
            selection: EditorSelection.single(absoluteSelection.anchor, absoluteSelection.head),
            annotations: textChanged
                ? syncAnnotation.of(true)
                : [syncAnnotation.of(true), Transaction.addToHistory.of(false)],
            scrollIntoView: false,
        });

        this.session.root = { text: rootText, selection: rootSelection };
        this.refreshFromCurrentMainState();
        this.rebaseLocalEditorFromRoot();
    }

    private flushSelectionToRoot(): void {
        this.forwardLocalStateToRoot(false);
    }

    private syncSelectionToMain(nestedView: EditorView, event?: MouseEvent): void {
        if (!this.session || !this.mainView) {
            return;
        }

        if (event && nestedView.state.selection.main.empty) {
            const clickedPos = nestedView.posAtCoords({ x: event.clientX, y: event.clientY });
            if (clickedPos != null) {
                const clamped = Math.max(0, Math.min(nestedView.state.doc.length, clickedPos));
                if (clamped !== nestedView.state.selection.main.head) {
                    nestedView.dispatch({
                        selection: EditorSelection.single(clamped, clamped),
                        annotations: Transaction.addToHistory.of(false),
                        scrollIntoView: false,
                    });
                }
            }
        }

        this.session.local.selection = {
            anchor: nestedView.state.selection.main.anchor,
            head: nestedView.state.selection.main.head,
        };
        const rootSelection = toRootSelection(this.session.local.selection, this.session.local.text);
        mirrorLocalSelectionToMain({
            nestedView,
            mainView: this.mainView,
            selection: toAbsoluteSelection(rootSelection, this.session.range.cellFrom),
        });
    }

    private refreshFromCurrentMainState(): void {
        if (!this.session || !this.mainView) {
            return;
        }

        const stateActiveCell = getActiveCell(this.mainView.state);
        if (stateActiveCell) {
            this.session.activeCell = stateActiveCell;
        }

        const resolved = resolveActiveCell(this.mainView.state, this.session.activeCell);
        if (!resolved) {
            return;
        }

        this.session.activeCell = resolved.activeCell;
        this.session.range = {
            tableFrom: resolved.tableFrom,
            tableTo: resolved.tableTo,
            cellFrom: resolved.cellFrom,
            cellTo: resolved.cellTo,
        };
        this.session.root = {
            text: this.mainView.state.doc.sliceString(resolved.cellFrom, resolved.cellTo),
            selection: toRelativeSelection(this.mainView.state.selection, resolved.cellFrom, resolved.cellTo),
        };
    }

    private rebaseLocalEditorFromRoot(): void {
        if (!this.session || !this.session.editor) {
            return;
        }

        const nextLocalText = unsanitizeRootText(this.session.root.text);
        const nextLocalSelection = toLocalSelection(this.session.root.selection, this.session.root.text);
        const editor = this.session.editor;
        const currentLocalText = editor.state.doc.toString();
        const currentSelection = {
            anchor: editor.state.selection.main.anchor,
            head: editor.state.selection.main.head,
        };

        if (currentLocalText === nextLocalText && areSelectionsEqual(currentSelection, nextLocalSelection)) {
            this.session.local = { text: nextLocalText, selection: nextLocalSelection };
            return;
        }

        const shouldRefocus = isEditorFocused(editor);
        this.session.applyingRootToLocal = true;
        editor.dispatch({
            changes:
                currentLocalText === nextLocalText
                    ? undefined
                    : { from: 0, to: editor.state.doc.length, insert: nextLocalText },
            selection: EditorSelection.single(nextLocalSelection.anchor, nextLocalSelection.head),
            annotations: [syncAnnotation.of(true), Transaction.addToHistory.of(false)],
            scrollIntoView: false,
        });
        this.session.applyingRootToLocal = false;
        this.session.local = { text: nextLocalText, selection: nextLocalSelection };

        if (shouldRefocus) {
            requestAnimationFrame(() => editor.contentDOM.focus({ preventScroll: true }));
        }
    }
}

export const nestedEditorPlugin = ViewPlugin.fromClass(
    class {
        controller = new NestedEditorController();

        destroy(): void {
            this.controller.close();
        }
    }
);

function getController(view: EditorView): NestedEditorController | null {
    const plugin = view.plugin(nestedEditorPlugin);
    return plugin ? plugin.controller : null;
}

export function openNestedEditor(params: {
    mainView: EditorView;
    cellElement: HTMLElement;
    activeCell: ActiveCell;
    initialCursorPos?: 'start' | 'end' | 'lastLineStart';
    onFocused?: () => void;
}): void {
    getController(params.mainView)?.open(params);
}

export function closeNestedEditor(view: EditorView, params?: { cellFrom?: number; cellTo?: number }): void {
    getController(view)?.close(params);
}

export function isNestedEditorOpen(view: EditorView): boolean {
    return getController(view)?.isOpen() ?? false;
}

export function handleMainEditorUpdate(view: EditorView, update: ViewUpdate): void {
    getController(view)?.handleMainEditorUpdate(update);
}

export function refocusNestedEditor(view: EditorView): void {
    getController(view)?.refocusWithPreventScroll();
}

export function cleanupHostedNestedEditors(view: EditorView, container: HTMLElement): void {
    getController(view)?.checkAndCloseIfHostedIn(container);
}
