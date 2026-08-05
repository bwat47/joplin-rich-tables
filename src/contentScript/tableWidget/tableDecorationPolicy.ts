import { Transaction, type StateEffectType } from '@codemirror/state';
import { clearActiveCellEffect, getActiveCell, setActiveCellEffect } from '../tableState/activeCellState';
import { isEffectiveRawMode, toggleSourceModeEffect } from '../tableState/sourceMode';
import { setSearchForceSourceModeEffect } from '../tableState/searchForceSourceMode';
import { rebuildAllTableWidgetsEffect, rebuildTableWidgetsEffect } from '../tableState/tableWidgetEffects';
import { syncAnnotation } from '../editorBridge/syncAnnotation';
import { getResolvedActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import { isFullDocumentReplace } from '../shared/transactionUtils';
import { normalizeBeforeEditAnnotation } from '../tableRuntime/lifecycle/tableNormalization';
import { transactionRequiresTableRebuild } from '../tableRuntime/tableTransactionHelpers';

export type DecorationDecision =
    | { type: 'keepDecorations' }
    | { type: 'noneDecorations' }
    | { type: 'mapDecorations' }
    | { type: 'rebuildAllDecorations' };

function hasEffect<T>(tr: Transaction, effectType: StateEffectType<T>): boolean {
    return tr.effects.some((effect) => effect.is(effectType));
}

/**
 * Raw mode replaces every table widget with plain markdown, so a toggle rebuilds
 * everything on the way out and drops all decorations on the way in.
 */
function decideRawModeDecoration(tr: Transaction): DecorationDecision | null {
    const effectiveRawMode = isEffectiveRawMode(tr.state);

    if (hasEffect(tr, toggleSourceModeEffect) || hasEffect(tr, setSearchForceSourceModeEffect)) {
        return effectiveRawMode ? { type: 'noneDecorations' } : { type: 'rebuildAllDecorations' };
    }

    return effectiveRawMode ? { type: 'noneDecorations' } : null;
}

/**
 * Changes forwarded from the nested editor only move text inside a cell, so the
 * existing widgets are still valid and just need remapping.
 */
function decideSyncDecoration(tr: Transaction): DecorationDecision | null {
    if (!tr.annotation(syncAnnotation)) {
        return null;
    }

    return tr.docChanged ? { type: 'mapDecorations' } : { type: 'keepDecorations' };
}

function decideRebuildRequestDecoration(tr: Transaction): DecorationDecision | null {
    if (hasEffect(tr, rebuildAllTableWidgetsEffect) || tr.annotation(normalizeBeforeEditAnnotation)) {
        return { type: 'rebuildAllDecorations' };
    }

    return null;
}

/**
 * A full replace while a cell is active (e.g. external sync) invalidates the
 * active cell; decorations are dropped and rebuilt once the lifecycle settles.
 */
function decideFullDocumentReplaceDecoration(tr: Transaction): DecorationDecision | null {
    if (!tr.docChanged || !getActiveCell(tr.startState) || !isFullDocumentReplace(tr)) {
        return null;
    }

    return { type: 'noneDecorations' };
}

/**
 * Switching activation to a different table ends the previous table's `mapDecorations`
 * window without a clear effect, leaving its widget frozen with cell ranges that predate
 * any in-cell edits — while `resolvedActiveCellField` moves on to the new table, so
 * `coordsAt()` can no longer live-resolve the old one. Rebuilding restores the invariant
 * that a frozen widget is always covered by the resolved active cell.
 */
function decideActiveTableSwitchDecoration(tr: Transaction): DecorationDecision | null {
    const previousTableFrom = getActiveCell(tr.startState)?.tableFrom;
    if (previousTableFrom === undefined) {
        return null;
    }

    const switchesTable = tr.effects.some(
        (effect) => effect.is(setActiveCellEffect) && effect.value.tableFrom !== previousTableFrom
    );
    return switchesTable ? { type: 'rebuildAllDecorations' } : null;
}

function decideDocumentEditDecoration(tr: Transaction): DecorationDecision {
    if (hasEffect(tr, clearActiveCellEffect) || hasEffect(tr, rebuildTableWidgetsEffect)) {
        return { type: 'rebuildAllDecorations' };
    }

    if (!tr.docChanged) {
        return { type: 'keepDecorations' };
    }

    if (!getActiveCell(tr.state)) {
        return { type: 'rebuildAllDecorations' };
    }

    return transactionRequiresTableRebuild(tr, getResolvedActiveCell(tr.startState))
        ? { type: 'rebuildAllDecorations' }
        : { type: 'mapDecorations' };
}

/**
 * Decides how the table decoration field reacts to a transaction.
 * The order of the checks below is significant: earlier decisions deliberately
 * win over later ones (a full document replace, for example, outranks a
 * rebuildTableWidgetsEffect in the same transaction).
 */
export function decideTableDecorationUpdate(tr: Transaction): DecorationDecision {
    return (
        decideRawModeDecoration(tr) ??
        decideSyncDecoration(tr) ??
        decideRebuildRequestDecoration(tr) ??
        decideFullDocumentReplaceDecoration(tr) ??
        decideActiveTableSwitchDecoration(tr) ??
        decideDocumentEditDecoration(tr)
    );
}
