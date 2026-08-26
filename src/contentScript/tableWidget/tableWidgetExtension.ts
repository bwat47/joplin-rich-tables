import { EditorView } from '@codemirror/view';
import type { Facet } from '@codemirror/state';
import type { ContentScriptContext, CodeMirrorControl, MarkdownEditorContentScriptModule } from 'api/types';
import {
    createMarkdownRenderer,
    markdownRenderServiceFacet,
    type MarkdownRenderService,
} from '../services/markdownRenderer';
import { fetchHostEditorConfig, hostEditorConfigFacet } from '../services/hostEditorConfig';
import { createJoplinBridge } from '../services/joplinBridge';
import { createLinkOpener, linkOpenerFacet, type LinkOpener } from '../services/linkOpener';
import { logger } from '../../logger';
import { activeCellField } from '../tableState/activeCellState';
import { resolvedActiveCellField } from '../tableRuntime/activeCell/resolvedActiveCell';
import { cellSelectionField } from '../tableState/cellSelectionState';
import { searchForceSourceModeField } from '../tableState/searchForceSourceMode';
import { sourceModeField } from '../tableState/sourceMode';
import { insertedTableActivationField } from '../tableState/insertedTableActivation';
import { cellSelectionClipboardPlugin } from '../tableRuntime/selection/cellSelectionClipboard';
import { cellSelectionKeyCapturePlugin } from '../tableRuntime/selection/cellSelectionKeymap';
import { cellSelectionVisualsPlugin } from './cellSelectionVisuals';
import { isNestedEditorOpen, nestedEditorPlugin } from '../nestedEditor/nestedEditorController';
import { nestedEditorFocusGuard } from '../nestedEditor/nestedEditorFocusGuard';
import { createMainEditorActiveCellGuard } from '../editorBridge/mainEditorGuard';
import { handleTableInteraction } from './tableWidgetInteractions';
import { tableToolbarPlugin, tableToolbarTheme } from '../toolbar/tableToolbarPlugin';
import { tableStyles } from './tableStyles';
import { richTableThemeVars } from './richTableThemeVars';
import { nestedEditorLifecyclePlugin } from '../tableRuntime/lifecycle/nestedEditorLifecycle';
import { registerTableCommands } from '../tableCommands/tableCommands';
import { searchPanelWatcherPlugin } from '../tableRuntime/searchPanelWatcher';
import {
    openCellRequestField,
    openCellRequestKeymap,
    openCellRequestTimeoutPlugin,
} from '../tableRuntime/openCellRequest';
import { createNoteIdWatcher } from '../tableRuntime/noteIdWatcher';
import { createUndoScrollPreservation } from '../tableRuntime/undoScrollPreservation';
import { mainEditorTableEntryExtension } from '../tableRuntime/navigation/mainEditorTableEntry';
import {
    closeOnOutsideMouseDown,
    outsideInteractionCapturePlugin,
} from '../tableRuntime/interaction/outsideTableInteraction';
import { createStartupCursorCorrection } from '../tableRuntime/startupCursorCorrection';
import { tableDecorationField } from './tableDecorationField';
import {
    rootEditorActiveCellAttribute,
    rootEditorSelectionSuppression,
} from '../nestedEditor/rootEditorSelectionTheme';

const tableWidgetInteractionHandlers = EditorView.domEventHandlers({
    mousedown: (event, view) => {
        return handleTableInteraction(view, event);
    },
    click: (event, view) => {
        return handleTableInteraction(view, event);
    },
});

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

        // Close nested editor on note switch (detected via noteIdFacet)
        createNoteIdWatcher(noteIdFacet, () => cm6View),
        createStartupCursorCorrection(() => cm6View),
        createUndoScrollPreservation(() => cm6View),

        searchPanelWatcherPlugin,
        searchForceSourceModeField,
        sourceModeField,
        nestedEditorPlugin,
        activeCellField,
        resolvedActiveCellField,
        openCellRequestField,
        insertedTableActivationField,
        cellSelectionField,
        mainEditorTableEntryExtension,
        createMainEditorActiveCellGuard(() => isNestedEditorOpen(cm6View)),
        openCellRequestKeymap,
        openCellRequestTimeoutPlugin,

        tableWidgetInteractionHandlers,
        closeOnOutsideMouseDown,
        outsideInteractionCapturePlugin,
        cellSelectionKeyCapturePlugin,
        cellSelectionClipboardPlugin,
        cellSelectionVisualsPlugin,
        nestedEditorFocusGuard,
        nestedEditorLifecyclePlugin,
        tableDecorationField,
        richTableThemeVars,
        tableStyles,
        rootEditorActiveCellAttribute,
        rootEditorSelectionSuppression,
        tableToolbarTheme,
        tableToolbarPlugin,
    ]);

    registerTableCommands(editorControl);

    logger.info('Table widget extension registered');
}
