import type { ToolbarActionId } from './toolbarLayout';

export function shouldToolbarActionFocusMainEditor(actionId: ToolbarActionId): boolean {
    return actionId !== 'insertRowBefore' && actionId !== 'insertRowAfter';
}
