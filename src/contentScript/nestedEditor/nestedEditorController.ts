import { ensureSyntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState, Transaction, type Extension } from '@codemirror/state';
import { drawSelection, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { inlineCodePlugin, insertPlugin, linkDestinationWrapPlugin, markPlugin } from './decorationPlugins';
import { createNestedEditorDomHandlers, createNestedEditorKeymap, mirrorLocalSelectionToMain } from './domHandlers';
import { createJoplinSyntaxHighlighting } from './joplinHighlightStyle';
import { createNestedEditorMarkdownExtension } from './nestedEditorMarkdown';
import { createNestedEditorTheme } from './nestedEditorTheme';
import { LocalSelection, toLocalSelection, toRootSelection } from '../editorBridge/cellTextCodec';
import { sanitizeLocalText, unsanitizeRootText } from '../shared/cellTextNormalization';
import { forceRootDomSelection } from '../editorBridge/rootDomSelection';
import { syncAnnotation } from '../editorBridge/syncAnnotation';
import { hasSyncAnnotation } from '../shared/transactionUtils';
import { ensureCellWrapper } from './mounting';
import {
    getResolvedActiveCell,
    resolveActiveCell,
    type CellContentRange,
    type ResolvedActiveCell,
} from '../tableRuntime/activeCell/resolvedActiveCell';
import { CLASS_CELL_ACTIVE } from '../shared/tableDomClasses';
import { markdownRenderServiceFacet } from '../services/markdownRenderer';
import { renderCellMarkdownInto } from '../services/renderCellInto';
import type { NestedEditorHostConfig } from '../../contentScriptBridge/hostEditorConfigBridge';
import { createNestedEditorFeatureExtensions } from './nestedEditorFeatureConfig';
import { requestViewAnimationFrame } from '../shared/domContext';
import { clamp } from '../shared/numberUtils';
import type { InitialCursorPos } from '../shared/cursorPlacement';
import {
    areSelectionsEqual,
    resolveInitialLocalSelection,
    toAbsoluteSelection,
    toRelativeSelection,
} from './nestedEditorSelection';

const SYNTAX_TREE_PARSE_TIMEOUT = 50;

interface NestedEditorTextState {
    text: string;
    selection: LocalSelection;
}

interface NestedEditorSession {
    resolvedCell: ResolvedActiveCell;
    /** Mirrors nested state, except for right-click selection mirroring; see `syncSelectionToMain`. */
    local: NestedEditorTextState;
    editor: EditorView | null;
}

export interface OpenNestedEditorParams {
    mainView: EditorView;
    cellElement: HTMLElement;
    /** The active cell, already resolved against the main editor's current state by the caller. */
    resolvedCell: ResolvedActiveCell;
    featureSettings: NestedEditorHostConfig;
    initialCursorPos?: InitialCursorPos;
}

class NestedEditorController {
    private session: NestedEditorSession | null = null;
    private contentEl: HTMLElement | null = null;
    private editorHostEl: HTMLElement | null = null;
    private cellElement: HTMLElement | null = null;
    private mainView: EditorView | null = null;

    open(params: OpenNestedEditorParams): void {
        this.close();

        const resolved = params.resolvedCell;
        this.mainView = params.mainView;
        this.cellElement = params.cellElement;

        const { content, editorHost } = ensureCellWrapper(params.cellElement);
        this.contentEl = content;
        this.editorHostEl = editorHost;

        this.cellElement.classList.add(CLASS_CELL_ACTIVE);
        editorHost.textContent = '';

        const rootText = params.mainView.state.doc.sliceString(resolved.editableFrom, resolved.editableTo);
        const localText = unsanitizeRootText(rootText);
        const rootSelection = toRelativeSelection(
            params.mainView.state.selection,
            resolved.editableFrom,
            resolved.editableTo
        );
        const localSelection = resolveInitialLocalSelection(
            toLocalSelection(rootSelection, rootText),
            localText,
            params.initialCursorPos
        );

        const session: NestedEditorSession = {
            resolvedCell: resolved,
            local: { text: localText, selection: localSelection },
            editor: null,
        };

        const isDarkTheme = params.mainView.state.facet(EditorView.darkTheme);
        const featureExtensions: Extension[] = createNestedEditorFeatureExtensions(params.featureSettings);
        const state = EditorState.create({
            doc: localText,
            selection: EditorSelection.single(localSelection.anchor, localSelection.head),
            extensions: [
                drawSelection(),
                EditorView.lineWrapping,
                EditorView.contentAttributes.of({
                    autocapitalize: 'sentences',
                }),
                ...featureExtensions,
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
                    closeEditor: () => this.close(),
                    syncPendingChangesToRoot: () => this.flushLocalStateToRoot(),
                }),
                createNestedEditorMarkdownExtension(),
                inlineCodePlugin,
                linkDestinationWrapPlugin,
                markPlugin,
                insertPlugin,
                createJoplinSyntaxHighlighting(isDarkTheme),
                createNestedEditorTheme(isDarkTheme),
            ],
        });
        // Warm the nested editor parse tree before mount to reduce first-paint decoration lag
        ensureSyntaxTree(state, state.doc.length, SYNTAX_TREE_PARSE_TIMEOUT);

        session.editor = new EditorView({
            state,
            parent: editorHost,
        });
        this.session = session;

        this.flushSelectionToRoot();
        session.editor.contentDOM.focus();
    }

    /**
     * Mirrors a main-editor update into the open session. Lifecycle policy calls this only for a
     * document or selection change that leaves the active cell resolved. When the cell stops
     * resolving, the main editor guard clears it in the same transaction and the lifecycle closes
     * the session.
     */
    handleMainEditorUpdate(update: ViewUpdate, resolvedCell: ResolvedActiveCell): void {
        if (!this.session || !this.mainView) {
            return;
        }

        this.session.resolvedCell = resolvedCell;

        const mainSelection = update.state.selection.main;

        forceRootDomSelection(this.mainView, {
            anchor: mainSelection.anchor,
            head: mainSelection.head,
        });

        this.rebaseLocalEditorFromRoot(this.readRootState(update.state, resolvedCell));
    }

    close(params?: CellContentRange): void {
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

        const cellRange = this.resolveCellRangeForClose(params, session, mainView);

        if (this.contentEl && mainView && cellRange) {
            const renderer = mainView.state.facet(markdownRenderServiceFacet);
            const { contentFrom, contentTo } = cellRange;
            const cellText = mainView.state.doc.sliceString(contentFrom, contentTo).trim();

            renderCellMarkdownInto(this.contentEl, cellText, renderer);
        }

        this.session = null;
        this.contentEl = null;
        this.editorHostEl = null;
        this.cellElement = null;
        this.mainView = null;
    }

    /**
     * Resolve cell range for close().
     *
     * A lifecycle close that runs inside a document-changing update passes the range explicitly:
     * the session is only synced from main-editor updates it is not closed by, so its cached
     * positions still reflect that update's start state.
     *
     * Otherwise the session's own cell identity is re-resolved against the current state. That
     * stays anchored to the session's table, rather than the newly active cell when open() closes
     * a previous session. An anchor that no longer matches a table start does not resolve, and the
     * cell keeps the rendering it had before the session opened.
     */
    private resolveCellRangeForClose(
        params: CellContentRange | undefined,
        session: NestedEditorSession | null,
        mainView: EditorView | null
    ): CellContentRange | null {
        if (params) {
            return params;
        }

        if (session && mainView) {
            const resolved = resolveActiveCell(mainView.state, session.resolvedCell.activeCell);
            if (resolved) {
                return { contentFrom: resolved.contentFrom, contentTo: resolved.contentTo };
            }
        }

        return null;
    }

    isOpen(): boolean {
        return Boolean(this.session?.editor);
    }

    flushLocalStateToRoot(): void {
        this.forwardLocalStateToRoot(true);
    }

    refocus(): void {
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

        // Ignore delayed updates from a nested editor instance that has already
        // been replaced during navigation or structural table edits.
        if (update.view !== this.session.editor) {
            return;
        }

        if (hasSyncAnnotation(update.transactions)) {
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
        const absoluteSelection = toAbsoluteSelection(rootSelection, this.session.resolvedCell.editableFrom);
        const currentMainSelection = this.mainView.state.selection.main;
        const previousRootText = this.readRootText(this.mainView.state, this.session.resolvedCell);

        const textChanged = rootText !== previousRootText;
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
                          from: this.session.resolvedCell.editableFrom,
                          to: this.session.resolvedCell.editableTo,
                          insert: rootText,
                      }
                    : undefined,
            selection: EditorSelection.single(absoluteSelection.anchor, absoluteSelection.head),
            annotations: textChanged
                ? syncAnnotation.of(true)
                : [syncAnnotation.of(true), Transaction.addToHistory.of(false)],
            scrollIntoView: false,
        });

        this.rebaseLocalEditorFromRoot(this.resyncResolvedCell({ text: rootText, selection: rootSelection }));
    }

    private flushSelectionToRoot(): void {
        this.forwardLocalStateToRoot(false);
    }

    private syncSelectionToMain(nestedView: EditorView, event: MouseEvent): void {
        if (!this.session || !this.mainView) {
            return;
        }

        let localSelection: LocalSelection = {
            anchor: nestedView.state.selection.main.anchor,
            head: nestedView.state.selection.main.head,
        };

        // For a right-click with no active selection, derive the cursor position from the click
        // coordinates so the main editor — and any context-menu plugins that read it (e.g. link
        // actions) — point at the clicked location. We mirror this position to the main editor
        // WITHOUT moving the nested editor's own selection: collapsing it here would override
        // Chromium's native selection of a misspelled word on right-click and suppress the host's
        // spelling suggestions. The browser positions the nested caret natively on right-click.
        if (nestedView.state.selection.main.empty) {
            const clickedPos = nestedView.posAtCoords({ x: event.clientX, y: event.clientY });
            if (clickedPos != null) {
                const clamped = clamp(clickedPos, 0, nestedView.state.doc.length);
                localSelection = { anchor: clamped, head: clamped };
            }
        }

        this.session.local.selection = localSelection;
        const rootSelection = toRootSelection(localSelection, this.session.local.text);
        mirrorLocalSelectionToMain({
            nestedView,
            mainView: this.mainView,
            selection: toAbsoluteSelection(rootSelection, this.session.resolvedCell.editableFrom),
        });
    }

    private readRootText(state: EditorState, resolved: ResolvedActiveCell): string {
        return state.doc.sliceString(resolved.editableFrom, resolved.editableTo);
    }

    private readRootState(state: EditorState, resolved: ResolvedActiveCell): NestedEditorTextState {
        return {
            text: this.readRootText(state, resolved),
            selection: toRelativeSelection(state.selection, resolved.editableFrom, resolved.editableTo),
        };
    }

    /**
     * Re-resolves the active cell against the current main state. On success, stores that cell on
     * the session and returns root text and selection sliced from it. On failure, mutates nothing
     * and returns `fallback`: `session.resolvedCell` stays stale and the session stays open.
     */
    private resyncResolvedCell(fallback: NestedEditorTextState): NestedEditorTextState {
        if (!this.session || !this.mainView) {
            return fallback;
        }

        const resolved = getResolvedActiveCell(this.mainView.state);
        if (!resolved) {
            return fallback;
        }

        this.session.resolvedCell = resolved;
        return this.readRootState(this.mainView.state, resolved);
    }

    private rebaseLocalEditorFromRoot(root: NestedEditorTextState): void {
        if (!this.session || !this.session.editor) {
            return;
        }

        const nextLocalText = unsanitizeRootText(root.text);
        const nextLocalSelection = toLocalSelection(root.selection, root.text);
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

        const shouldRefocus = editor.hasFocus;
        editor.dispatch({
            changes:
                currentLocalText === nextLocalText
                    ? undefined
                    : { from: 0, to: editor.state.doc.length, insert: nextLocalText },
            selection: EditorSelection.single(nextLocalSelection.anchor, nextLocalSelection.head),
            annotations: [syncAnnotation.of(true), Transaction.addToHistory.of(false)],
            scrollIntoView: false,
        });
        this.session.local = { text: nextLocalText, selection: nextLocalSelection };

        const mainView = this.mainView;
        if (shouldRefocus && mainView) {
            requestViewAnimationFrame(mainView, () => editor.contentDOM.focus());
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

/** Mounts a nested editor for `params.resolvedCell`; false when the view has no controller. */
export function openNestedEditor(params: OpenNestedEditorParams): boolean {
    const controller = getController(params.mainView);
    if (!controller) {
        return false;
    }

    controller.open(params);
    return true;
}

export function closeNestedEditor(view: EditorView, params?: CellContentRange): void {
    getController(view)?.close(params);
}

export function isNestedEditorOpen(view: EditorView): boolean {
    return getController(view)?.isOpen() ?? false;
}

export function handleMainEditorUpdate(view: EditorView, update: ViewUpdate, resolvedCell: ResolvedActiveCell): void {
    getController(view)?.handleMainEditorUpdate(update, resolvedCell);
}

export function refocusNestedEditor(view: EditorView): void {
    getController(view)?.refocus();
}

/** Flushes the nested editor's current text and selection before an external interaction takes ownership. */
export function flushNestedEditorState(view: EditorView): void {
    getController(view)?.flushLocalStateToRoot();
}

export function cleanupHostedNestedEditors(view: EditorView, container: HTMLElement): void {
    getController(view)?.checkAndCloseIfHostedIn(container);
}
