import { Transaction, type StateEffectType } from '@codemirror/state';
import { isEffectiveRawMode, toggleSourceModeEffect } from '../tableState/sourceMode';
import { setSearchForceSourceModeEffect } from '../tableState/searchForceSourceMode';
import { rebuildTableWidgetsEffect } from '../tableState/tableWidgetEffects';

export type DecorationDecision =
    { type: 'noneDecorations' } | { type: 'rebuildAllDecorations' } | { type: 'reconcileDecorations' };

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

function decideRebuildRequestDecoration(tr: Transaction): DecorationDecision | null {
    if (hasEffect(tr, rebuildTableWidgetsEffect)) {
        return { type: 'rebuildAllDecorations' };
    }

    return null;
}

/**
 * Routes a transaction to drop, force-render, or reconcile table decorations.
 * `reconcileTableDecorations()` owns parser recovery and active-host preservation.
 *
 * The order of the checks below is significant: earlier decisions deliberately
 * win over later ones (raw mode, for example, outranks any rebuild request).
 */
export function decideTableDecorationUpdate(tr: Transaction): DecorationDecision {
    return decideRawModeDecoration(tr) ?? decideRebuildRequestDecoration(tr) ?? { type: 'reconcileDecorations' };
}
