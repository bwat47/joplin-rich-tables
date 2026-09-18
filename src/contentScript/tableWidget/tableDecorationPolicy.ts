import { Transaction, type StateEffectType } from '@codemirror/state';
import { isEffectiveRawMode, toggleSourceModeEffect } from '../tableState/sourceMode';
import { setSearchForceSourceModeEffect } from '../tableState/searchForceSourceMode';

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

/**
 * Routes a transaction to drop, force-render, or reconcile table decorations.
 * `reconcileTableDecorations()` owns parser recovery and active-host preservation.
 * Structural table edits need no branch here: they replace the whole table range, so
 * reconciliation already renders a fresh widget for them.
 */
export function decideTableDecorationUpdate(tr: Transaction): DecorationDecision {
    return decideRawModeDecoration(tr) ?? { type: 'reconcileDecorations' };
}
