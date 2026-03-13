import { EditorView, Decoration, DecorationSet, ViewPlugin } from '@codemirror/view';
import { EditorState, Range, StateField, ChangeSet } from '@codemirror/state';
import type { Facet } from '@codemirror/state';
import type { ContentScriptContext, CodeMirrorControl } from 'api/types';
import { TableWidget } from './TableWidget';
import { buildTableContext } from '../tableModel/tableContext';
import { initRenderer } from '../services/markdownRenderer';
import { documentDefinitionsField } from '../services/documentDefinitions';
import { logger } from '../../logger';
import { hashTableText } from './hashUtils';
import { activeCellField, clearActiveCellEffect, getActiveCell } from './activeCellState';
import {
    closeNestedCellEditor,
    isNestedCellEditorOpen,
    nestedCellEditorPlugin,
    refocusNestedEditor,
} from '../nestedEditor/nestedCellEditor';
import { createMainEditorActiveCellGuard } from '../nestedEditor/mainEditorGuard';
import { handleTableInteraction } from './tableWidgetInteractions';
import { findTableRanges } from './tablePositioning';
import { tableToolbarPlugin, tableToolbarTheme } from '../toolbar/tableToolbarPlugin';
import { CLASS_CELL_EDITOR, CLASS_FLOATING_TOOLBAR, getWidgetSelector } from './domHelpers';
import { tableStyles } from './tableStyles';
import { nestedEditorLifecyclePlugin } from './nestedEditorLifecycle';
import { registerTableCommands } from '../tableCommands/tableCommands';
import { searchPanelWatcherPlugin } from './searchPanelWatcher';
import { sourceModeField } from './sourceMode';
import { searchForceSourceModeField } from './searchForceSourceMode';
import { navigationLockKeymap } from './navigationLockKeymap';
import { createNoteIdWatcher } from './noteIdWatcher';
import { moveCursorOutOfTable } from './cursorUtils';
import { decideTableDecorationUpdate } from './tableRuntimeTransitions';

/**
 * Rebuild only the decoration for a single table, mapping all other decorations.
 * This is used for structural changes (row/col add/delete) to avoid rebuilding all tables.
 */
function rebuildSingleTable(
    state: EditorState,
    decorations: DecorationSet,
    oldTableFrom: number,
    changes: ChangeSet
): DecorationSet {
    // Map the old tableFrom position through the changes to find where it is now
    const newTableFrom = changes.mapPos(oldTableFrom);

    // Find the table at the new position
    const tables = findTableRanges(state);
    const targetTable = tables.find((t) => t.from === newTableFrom);

    if (!targetTable) {
        // Table no longer exists (e.g. deleted) — rebuild all decorations from scratch.
        // Mapping stale decorations can leave collapsed zero-width replace widgets in the DOM.
        return buildTableDecorations(state);
    }

    // Build new decoration for the target table
    const definitions = state.field(documentDefinitionsField);
    const ctx = buildTableContext(targetTable);

    if (!ctx) {
        return decorations.map(changes);
    }

    const contentHash = hashTableText(targetTable.text + definitions.definitionBlock);
    const widget = new TableWidget(
        ctx.table,
        ctx.cellRanges,
        targetTable.text,
        targetTable.from,
        targetTable.to,
        definitions.definitionBlock,
        contentHash
    );
    const newDecoration = Decoration.replace({ widget, block: true });

    // Build new decoration set: map all decorations through changes, then replace the target
    const mapped = decorations.map(changes);
    const result: Range<Decoration>[] = [];

    // Keep all decorations except those that overlap the new table range
    // Structural changes (like adding a row above) shift the table's position,
    // so checking `from !== targetTable.from` is insufficient.
    mapped.between(0, state.doc.length, (from, to, deco) => {
        // If decoration overlaps with the new target table, drop it (it's the old version)
        if (to <= targetTable.from || from >= targetTable.to) {
            result.push(deco.range(from, to));
        }
    });

    // Add the new decoration for the rebuilt table
    result.push(newDecoration.range(targetTable.from, targetTable.to));

    // Valid DecorationSets MUST be sorted. Since we are manually constructing the array
    // (and potentially appending out of order), we must sort it explicitly to be safe.
    result.sort((a, b) => a.from - b.from);

    return Decoration.set(result, true); // true = we have manually sorted it
}

/**
 * Build decorations for all tables in the document.
 * Tables are always rendered as widgets - editing happens via nested cell editors.
 */
function buildTableDecorations(state: EditorState): DecorationSet {
    const decorations: Range<Decoration>[] = [];
    const tables = findTableRanges(state);
    const definitions = state.field(documentDefinitionsField);

    for (const table of tables) {
        const ctx = buildTableContext(table);
        if (!ctx) {
            continue;
        }

        // Content hash includes definition block so widgets rebuild when definitions change.
        const contentHash = hashTableText(table.text + definitions.definitionBlock);

        const widget = new TableWidget(
            ctx.table,
            ctx.cellRanges,
            table.text,
            table.from,
            table.to,
            definitions.definitionBlock,
            contentHash
        );
        const decoration = Decoration.replace({
            widget,
            block: true,
        });

        decorations.push(decoration.range(table.from, table.to));
    }

    return Decoration.set(decorations);
}

/**
 * StateField that manages table widget decorations.
 * Block decorations MUST be provided via StateField, not ViewPlugin.
 * Tables are always rendered as widgets (unless source mode is toggled).
 */
const tableDecorationField = StateField.define<DecorationSet>({
    create(state) {
        logger.info('Table decoration field initialized');
        return buildTableDecorations(state);
    },
    update(decorations, transaction) {
        const decision = decideTableDecorationUpdate(transaction);

        switch (decision.type) {
            case 'noneDecorations':
                return Decoration.none;
            case 'keepDecorations':
                return decorations;
            case 'mapDecorations':
                return decorations.map(transaction.changes);
            case 'rebuildAllDecorations':
                return buildTableDecorations(transaction.state);
            case 'rebuildSingleTable':
                return rebuildSingleTable(transaction.state, decorations, decision.tableFrom, transaction.changes);
        }
    },
    provide: (field) => EditorView.decorations.from(field),
});

function getEventTargetElement(event: MouseEvent | PointerEvent): Element | null {
    const target = event.target;
    if (!target) return null;
    if (target instanceof Element) return target;
    if (target instanceof Node) return target.parentElement;
    return null;
}

function handleOutsideTableInteraction(
    view: EditorView,
    event: MouseEvent | PointerEvent,
    options: { preserveContextMenu: boolean }
): boolean {
    const target = getEventTargetElement(event);
    if (!target) {
        return false;
    }

    // Keep editor open if interaction is inside the widget or nested editor.
    if (
        target.closest(getWidgetSelector()) ||
        target.closest(`.${CLASS_CELL_EDITOR}`) ||
        target.closest(`.${CLASS_FLOATING_TOOLBAR}`)
    ) {
        return false;
    }

    const hasActiveCell = Boolean(getActiveCell(view.state));
    const hasNestedEditor = isNestedCellEditorOpen(view);
    if (!hasActiveCell && !hasNestedEditor) {
        return false;
    }

    const clickPos = view.posAtCoords({ x: event.clientX, y: event.clientY });

    if (hasNestedEditor) {
        closeNestedCellEditor(view);
    }

    if (clickPos !== null) {
        // On right-click context menus, avoid forcing focus/scroll so the native/Joplin
        // menu opens against the expected pointer target without viewport jumps.
        view.dispatch({
            selection: { anchor: clickPos },
            effects: hasActiveCell ? clearActiveCellEffect.of(undefined) : [],
            scrollIntoView: !options.preserveContextMenu,
        });
        if (!options.preserveContextMenu) {
            view.focus();
        } else if (hasNestedEditor) {
            // The nested editor we just destroyed held focus; restore it to the
            // main editor without scrolling so the caret is painted.
            view.contentDOM.focus({ preventScroll: true });
        }
    } else if (hasActiveCell) {
        view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
    }

    // For mousedown, consume only if we positioned the cursor.
    // For contextmenu, never consume so native/Joplin menus can open.
    return !options.preserveContextMenu && clickPos !== null;
}

const closeOnOutsideMouseDown = EditorView.domEventHandlers({
    mousedown: (event, view) => {
        return handleOutsideTableInteraction(view, event, { preserveContextMenu: false });
    },
});

const outsideInteractionCapturePlugin = ViewPlugin.fromClass(
    class {
        private readonly onContextMenu: (event: MouseEvent) => void;

        constructor(private readonly view: EditorView) {
            this.onContextMenu = (event) => {
                // Return value is intentionally ignored for document-level contextmenu.
                // We only need side effects (close/clear), not event consumption control.
                handleOutsideTableInteraction(this.view, event, { preserveContextMenu: true });
            };

            const doc = this.view.dom.ownerDocument;
            // Register on the document in capture phase so outside right-click interactions
            // are seen even when Joplin/Electron context menu handlers intercept later in bubbling.
            doc.addEventListener('contextmenu', this.onContextMenu, true);
        }

        destroy(): void {
            const doc = this.view.dom.ownerDocument;
            doc.removeEventListener('contextmenu', this.onContextMenu, true);
        }
    }
);

const tableWidgetInteractionHandlers = EditorView.domEventHandlers({
    mousedown: (event, view) => {
        return handleTableInteraction(view, event);
    },
    click: (event, view) => {
        return handleTableInteraction(view, event);
    },
});

/**
 * Defensive focus handler that reclaims focus for the nested editor when it's
 * unexpectedly stolen (e.g., by Android's focus management after toolbar commands).
 * Uses preventScroll to avoid scroll jumps.
 */
const nestedEditorFocusGuard = EditorView.domEventHandlers({
    focus: (_event, view) => {
        // If the nested editor is open and should have focus, reclaim it.
        // This handles cases where Android or other focus management systems
        // redirect focus to the main editor after toolbar button presses.
        if (isNestedCellEditorOpen(view) && getActiveCell(view.state)) {
            refocusNestedEditor(view);
            return true;
        }
        return false;
    },
});

/**
 * Content script module export.
 */
export default function (context: ContentScriptContext) {
    logger.info('Content script loaded');

    // Initialize the markdown renderer with postMessage function
    initRenderer(context.postMessage);

    return {
        plugin: (editorControl: CodeMirrorControl) => {
            logger.info('Registering table widget extension');

            // Check for CM6
            if (!editorControl.cm6) {
                logger.warn('CodeMirror 6 not available, skipping');
                return;
            }

            // Cast for type safety - official types use `any`
            const cm6View = editorControl.cm6 as EditorView;
            const noteIdFacet = editorControl.joplinExtensions.noteIdFacet as Facet<string, string>;

            editorControl.addExtension([
                // Close nested editor on note switch (detected via noteIdFacet)
                createNoteIdWatcher(noteIdFacet, () => cm6View),

                searchPanelWatcherPlugin,
                searchForceSourceModeField,
                sourceModeField,
                nestedCellEditorPlugin,
                activeCellField,
                createMainEditorActiveCellGuard(() => isNestedCellEditorOpen(cm6View)),
                navigationLockKeymap, // Block Tab/Enter during row creation rebuild

                tableWidgetInteractionHandlers,
                closeOnOutsideMouseDown,
                outsideInteractionCapturePlugin,
                nestedEditorFocusGuard,
                nestedEditorLifecyclePlugin,
                tableDecorationField,
                documentDefinitionsField,
                tableStyles,
                tableToolbarTheme,
                tableToolbarPlugin,
            ]);

            registerTableCommands(editorControl);

            // Move cursor out of table on initial load.
            // On mobile, the content script loads fresh per note, so this handles note switching.
            // On desktop, this handles cold launch when Joplin restores cursor position inside a table.
            setTimeout(() => {
                const moved = moveCursorOutOfTable(cm6View);
                if (moved) {
                    logger.debug('Moved cursor out of table on content script init');
                }
            }, 0);

            logger.info('Table widget extension registered');
        },
    };
}
