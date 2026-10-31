import type { Facet } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

import type { CodeMirrorControl, ContentScriptContext, MarkdownEditorContentScriptModule } from 'api/types';
import { logger } from '../logger';
import { isNestedEditorOpen, nestedEditorPlugin } from './nestedEditor/nestedEditorController';
import { nestedEditorFocusGuard } from './nestedEditor/nestedEditorFocusGuard';
import { fetchHostEditorConfig, hostEditorConfigFacet } from './services/hostEditorConfig';
import { createJoplinBridge } from './services/joplinBridge';
import { createLinkOpener, linkOpenerFacet, type LinkOpener } from './services/linkOpener';
import {
    createMarkdownRenderer,
    markdownRenderServiceFacet,
    type MarkdownRenderService,
} from './services/markdownRenderer';
import { noteIdentityFacet } from './services/noteIdentity';
import { registerTableCommands } from './tableCommands/tableCommands';
import { tableBoundaryDeletionExtension } from './tableRuntime/boundaries/tableBoundaryDeletion';
import { tableBoundaryMaintenanceExtension } from './tableRuntime/boundaries/tableBoundaryMaintenance';
import { createMainEditorActiveCellGuard } from './tableRuntime/guard/mainEditorGuard';
import { mouseCellDragSelectionPlugin } from './tableRuntime/interaction/mouseCellDragSelection';
import {
    closeOnOutsideMouseDown,
    outsideInteractionCapturePlugin,
} from './tableRuntime/interaction/outsideTableInteraction';
import { widgetInteractionHandlers } from './tableRuntime/interaction/widgetInteraction';
import { nestedEditorLifecyclePlugin } from './tableRuntime/lifecycle/nestedEditorLifecycle';
import { createUndoScrollPreservation } from './tableRuntime/lifecycle/undoScrollPreservation';
import { mainEditorTableEntryExtension } from './tableRuntime/navigation/mainEditorTableEntry';
import { openCellRequestKeymap, openCellRequestTimeoutPlugin } from './tableRuntime/openCellRequest';
import { searchMatchCellEntryExtension } from './tableRuntime/search/searchMatchCellEntry';
import { searchPanelTransitionExtension } from './tableRuntime/search/searchPanelTransitions';
import { cellSelectionClipboardPlugin } from './tableRuntime/selection/cellSelectionClipboardPlugin';
import { cellSelectionFocusPlugin } from './tableRuntime/selection/cellSelectionController';
import { cellSelectionEditRetention } from './tableRuntime/selection/cellSelectionEditRetention';
import { cellSelectionKeyCapturePlugin } from './tableRuntime/selection/cellSelectionKeymap';
import { cellSelectionRangeRelease } from './tableRuntime/selection/cellSelectionRangeRelease';
import { cellSelectionScopeGuard } from './tableRuntime/selection/cellSelectionScopeGuard';
import { tableSelectionSnapFilter } from './tableRuntime/selection/tableSelectionSnap';
import { activeCellField } from './tableState/activeCellState';
import { cellDragField } from './tableState/cellDragState';
import { cellSelectionField } from './tableState/cellSelectionState';
import { openCellRequestField } from './tableState/openCellRequestState';
import { sourceModeField } from './tableState/sourceMode';
import { tableContextField } from './tableState/tableContextField';
import { cellSelectionVisuals } from './tableWidget/cellSelectionVisuals';
import { mainCaretSuppression } from './tableWidget/mainCaretSuppression';
import { renderedTextSelectionTheme } from './tableWidget/renderedTextSelectionTheme';
import { richTableThemeVars } from './tableWidget/richTableThemeVars';
import { rootEditorActiveCellAttribute, rootEditorSelectionPainting } from './tableWidget/rootEditorSelectionTheme';
import { tableDecorationField } from './tableWidget/tableDecorationField';
import { tableStyles } from './tableWidget/tableStyles';
import { wholeTableSelectionVisuals } from './tableWidget/wholeTableSelectionVisuals';
import { tableToolbarPlugin, tableToolbarTheme } from './toolbar/tableToolbarPlugin';

/**
 * Content script module export.
 */
export default function tableWidgetExtension(context: ContentScriptContext): MarkdownEditorContentScriptModule {
    logger.info('Content script loaded');

    const joplinBridge = createJoplinBridge(context.postMessage);
    const markdownRenderer = createMarkdownRenderer(joplinBridge.renderMarkup);
    const linkOpener = createLinkOpener(joplinBridge.openLink);

    return {
        plugin: (editorControl: CodeMirrorControl) => {
            void registerTableWidgetExtension(editorControl, context, {
                markdownRenderer,
                linkOpener,
            });
        },
    };
}

async function registerTableWidgetExtension(
    editorControl: CodeMirrorControl,
    context: ContentScriptContext,
    services: {
        markdownRenderer: MarkdownRenderService;
        linkOpener: LinkOpener;
    }
): Promise<void> {
    logger.info('Registering table widget extension');

    // Check for CM6
    if (!editorControl.cm6) {
        logger.warn('CodeMirror 6 not available, skipping');
        return;
    }

    const hostEditorConfig = await fetchHostEditorConfig(context.postMessage);

    // Cast for type safety - official types use `any`
    const cm6View = editorControl.cm6 as EditorView;
    const noteIdFacet = editorControl.joplinExtensions.noteIdFacet as Facet<string, string>;

    editorControl.addExtension([
        hostEditorConfigFacet.of(hostEditorConfig),
        markdownRenderServiceFacet.of(services.markdownRenderer),
        linkOpenerFacet.of(services.linkOpener),
        noteIdentityFacet.compute([noteIdFacet], (state) => state.facet(noteIdFacet)),

        createUndoScrollPreservation(() => cm6View),

        searchPanelTransitionExtension,
        searchMatchCellEntryExtension,
        sourceModeField,
        nestedEditorPlugin,
        tableContextField,
        activeCellField,
        openCellRequestField,
        cellSelectionField,
        cellSelectionEditRetention,
        cellDragField,
        tableBoundaryDeletionExtension,
        mainEditorTableEntryExtension,
        tableSelectionSnapFilter,
        // Registered ahead of the guard so its paste rewrites are already spaced when
        // boundary maintenance inspects the result.
        tableBoundaryMaintenanceExtension,
        createMainEditorActiveCellGuard(() => isNestedEditorOpen(cm6View)),
        openCellRequestKeymap,
        openCellRequestTimeoutPlugin,

        mouseCellDragSelectionPlugin,
        // Registered ahead of `closeOnOutsideMouseDown` so a widget press is routed first. CodeMirror
        // stops running handlers for an event once one returns true, and appends its own built-in
        // handlers after every plugin's, so a press this router takes reaches neither.
        widgetInteractionHandlers,
        closeOnOutsideMouseDown,
        outsideInteractionCapturePlugin,
        cellSelectionKeyCapturePlugin,
        cellSelectionScopeGuard,
        cellSelectionRangeRelease,
        cellSelectionClipboardPlugin,
        cellSelectionFocusPlugin,
        cellSelectionVisuals,
        mainCaretSuppression,
        wholeTableSelectionVisuals,
        renderedTextSelectionTheme,
        nestedEditorFocusGuard,
        nestedEditorLifecyclePlugin,
        tableDecorationField,
        richTableThemeVars,
        tableStyles,
        rootEditorActiveCellAttribute,
        rootEditorSelectionPainting,
        tableToolbarTheme,
        tableToolbarPlugin,
    ]);

    registerTableCommands(editorControl);

    logger.info('Table widget extension registered');
}
