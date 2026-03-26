import { Transaction } from '@codemirror/state';
import { clearActiveCellEffect, getActiveCell } from '../tableState/activeCellState';
import { isEffectiveRawMode, toggleSourceModeEffect } from '../tableState/sourceMode';
import { setSearchForceSourceModeEffect } from '../tableState/searchForceSourceMode';
import { rebuildAllTableWidgetsEffect, rebuildTableWidgetsEffect } from '../tableState/tableWidgetEffects';
import { syncAnnotation } from '../editorBridge/syncAnnotation';
import { getResolvedActiveCell } from '../tableRuntime/activeCell/resolvedActiveCellField';
import { isFullDocumentReplace } from '../shared/transactionUtils';
import { normalizeBeforeEditAnnotation } from '../tableRuntime/lifecycle/tableNormalization';
import { transactionRequiresTableRebuild } from '../tableRuntime/lifecycle/lifecyclePolicy';

export type DecorationDecision =
    | { type: 'keepDecorations' }
    | { type: 'noneDecorations' }
    | { type: 'mapDecorations' }
    | { type: 'rebuildAllDecorations' };

export function decideTableDecorationUpdate(tr: Transaction): DecorationDecision {
    const rawModeToggled = tr.effects.some(
        (effect) => effect.is(toggleSourceModeEffect) || effect.is(setSearchForceSourceModeEffect)
    );
    const effectiveRawMode = isEffectiveRawMode(tr.state);

    if (rawModeToggled) {
        return effectiveRawMode ? { type: 'noneDecorations' } : { type: 'rebuildAllDecorations' };
    }

    if (effectiveRawMode) {
        return { type: 'noneDecorations' };
    }

    if (tr.annotation(syncAnnotation)) {
        return tr.docChanged ? { type: 'mapDecorations' } : { type: 'keepDecorations' };
    }

    if (tr.effects.some((effect) => effect.is(rebuildAllTableWidgetsEffect))) {
        return { type: 'rebuildAllDecorations' };
    }

    if (tr.annotation(normalizeBeforeEditAnnotation)) {
        return { type: 'rebuildAllDecorations' };
    }

    const prevActiveCell = getActiveCell(tr.startState);
    const resolvedPrevActiveCell = getResolvedActiveCell(tr.startState);
    if (tr.docChanged && prevActiveCell && isFullDocumentReplace(tr)) {
        return { type: 'noneDecorations' };
    }

    if (tr.effects.some((effect) => effect.is(clearActiveCellEffect))) {
        return { type: 'rebuildAllDecorations' };
    }

    if (tr.effects.some((effect) => effect.is(rebuildTableWidgetsEffect))) {
        return { type: 'rebuildAllDecorations' };
    }

    if (!tr.docChanged) {
        return { type: 'keepDecorations' };
    }

    const activeCell = getActiveCell(tr.state);
    if (!activeCell) {
        return { type: 'rebuildAllDecorations' };
    }

    return transactionRequiresTableRebuild(tr, resolvedPrevActiveCell)
        ? { type: 'rebuildAllDecorations' }
        : { type: 'mapDecorations' };
}
