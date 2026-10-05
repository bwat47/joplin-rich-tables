/**
 * Nested-editor operations that UI layers (widgets, toolbar) may perform on an editor they do not control.
 * None of them opens an editor or changes document content, and each is a no-op when no nested editor is open.
 * Opening, closing, and syncing stay in `nestedEditorController`, which only `tableRuntime` may import.
 */
export { cleanupHostedNestedEditors, isNestedEditorOpen, refocusNestedEditor } from './nestedEditorController';
