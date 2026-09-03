/**
 * @vitest-environment jsdom
 */

import { EditorState } from '@codemirror/state';
import { describe, expect, it, vi } from 'vitest';
import { defaultHostEditorConfig, type HostEditorConfig } from '../../contentScriptBridge/hostEditorConfigBridge';
import { fetchHostEditorConfig, hostEditorConfigFacet } from '../services/hostEditorConfig';

vi.mock('../../logger', () => ({
    logger: {
        warn: vi.fn(),
    },
}));

describe('hostEditorConfig', () => {
    const validConfig: HostEditorConfig = {
        nestedEditor: {
            autoMatchingBraces: true,
            spellcheck: true,
        },
        tableAppearance: {
            zebraStriping: true,
        },
        toolbar: {
            showMoveButtons: false,
            showClearButtons: true,
            showAlignmentButtons: false,
            showDeleteTableButton: true,
        },
    };

    it('fetches a valid host editor config', async () => {
        const postMessage = vi.fn<(message: unknown) => Promise<HostEditorConfig>>(async () => validConfig);

        await expect(fetchHostEditorConfig(postMessage)).resolves.toEqual(validConfig);
        expect(postMessage).toHaveBeenCalledWith({
            type: 'getHostEditorConfig',
        });
    });

    it('returns defaults when the startup response is malformed', async () => {
        const postMessage = vi.fn(async () => ({ invalid: true }));

        await expect(fetchHostEditorConfig(postMessage)).resolves.toEqual(defaultHostEditorConfig());
    });

    it('returns defaults when the startup request rejects', async () => {
        const postMessage = vi.fn(async () => {
            throw new Error('boom');
        });

        await expect(fetchHostEditorConfig(postMessage)).resolves.toEqual(defaultHostEditorConfig());
    });

    it('exposes defaults when the facet is absent', () => {
        const state = EditorState.create();

        expect(state.facet(hostEditorConfigFacet)).toEqual(defaultHostEditorConfig());
    });
});
