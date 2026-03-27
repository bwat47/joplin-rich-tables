import { describe, expect, it } from '@jest/globals';
import { createNestedEditorFeatureExtensions } from '../nestedEditor/nestedEditorFeatureConfig';

describe('nestedEditorFeatureConfig', () => {
    it('adds close-bracket extensions only when auto matching braces is enabled', () => {
        expect(
            createNestedEditorFeatureExtensions({
                autoMatchingBraces: true,
            })
        ).toHaveLength(2);
        expect(
            createNestedEditorFeatureExtensions({
                autoMatchingBraces: false,
            })
        ).toHaveLength(0);
    });
});
