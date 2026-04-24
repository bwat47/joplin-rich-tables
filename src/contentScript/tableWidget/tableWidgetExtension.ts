import { EditorView } from '@codemirror/view';
import type { Facet } from '@codemirror/state';
import type { ContentScriptContext, CodeMirrorControl } from 'api/types';
import { initRenderer } from '../services/markdownRenderer';
import { initNestedEditorFeatureSettings } from '../services/nestedEditorFeatureSettings';
import { initToolbarSettings } from '../services/toolbarSettings';
import { documentDefinitionsField } from '../services/documentDefinitions';
import { logger } from '../../logger';
import { activeCellField } from '../tableState/activeCellState';
import { resolvedActiveCellField } from '../tableRuntime/activeCell/resolvedActiveCell';
import { cellSelectionField } from '../tableState/cellSelectionState';
import { searchForceSourceModeField } from '../tableState/searchForceSourceMode';
import { sourceModeField } from '../tableState/sourceMode';
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
import {
    closeOnOutsideMouseDown,
    outsideInteractionCapturePlugin,
} from '../tableRuntime/interaction/outsideTableInteraction';
import { createStartupCursorCorrection } from '../tableRuntime/startupCursorCorrection';
import { tableDecorationField } from './tableDecorationField';

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
export default function (context: ContentScriptContext) {
    logger.info('Content script loaded');

    // Initialize the markdown renderer with postMessage function
    initRenderer(context.postMessage);
    void initNestedEditorFeatureSettings(context.postMessage);
    void initToolbarSettings(context.postMessage);

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
                createStartupCursorCorrection(() => cm6View),
                createUndoScrollPreservation(() => cm6View),

                searchPanelWatcherPlugin,
                searchForceSourceModeField,
                sourceModeField,
                nestedEditorPlugin,
                activeCellField,
                resolvedActiveCellField,
                openCellRequestField,
                cellSelectionField,
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
                documentDefinitionsField,
                richTableThemeVars,
                tableStyles,
                tableToolbarTheme,
                tableToolbarPlugin,
            ]);

            registerTableCommands(editorControl);

            logger.info('Table widget extension registered');
        },
    };
}
