import joplin from 'api';
import { ContentScriptType } from 'api/types';
import { logger } from './logger';

const CONTENT_SCRIPT_ID = 'rich-tables-editor';

joplin.plugins.register({
    onStart: async function () {
        logger.info('Rich Tables plugin starting...');

        // Register the CodeMirror content script
        await joplin.contentScripts.register(
            ContentScriptType.CodeMirrorPlugin,
            CONTENT_SCRIPT_ID,
            './contentScript/tableEditor.js'
        );

        logger.info('Rich Tables plugin started');
    },
});
