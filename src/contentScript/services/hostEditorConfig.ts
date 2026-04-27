import { Facet } from '@codemirror/state';
import { logger } from '../../logger';
import {
    defaultHostEditorConfig,
    isHostEditorConfig,
    type GetHostEditorConfigMessage,
    type HostEditorConfig,
} from '../../contentScriptBridge/hostEditorConfigBridge';

type PostMessageFn = (message: unknown) => Promise<unknown>;

export const hostEditorConfigFacet = Facet.define<HostEditorConfig, HostEditorConfig>({
    combine: (values) => values[0] ?? defaultHostEditorConfig(),
});

export async function fetchHostEditorConfig(postMessage: PostMessageFn): Promise<HostEditorConfig> {
    const request: GetHostEditorConfigMessage = {
        type: 'getHostEditorConfig',
    };

    try {
        const result = await postMessage(request);
        if (!isHostEditorConfig(result)) {
            logger.warn('Received invalid host editor config during initialization, using defaults', result);
            return defaultHostEditorConfig();
        }

        return result;
    } catch (error) {
        logger.warn('Failed to fetch host editor config during initialization, using defaults', error);
        return defaultHostEditorConfig();
    }
}
