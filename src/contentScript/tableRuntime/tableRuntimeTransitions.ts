import { ChangeSet, EditorSelection, SelectionRange, Transaction } from '@codemirror/state';
import { ViewUpdate } from '@codemirror/view';
import { clearActiveCellEffect, getActiveCell, isSameActiveCell, type ActiveCell } from '../tableState/activeCellState';
import { cellSelectionTransitionAnnotation, getCellSelection } from '../tableState/cellSelectionState';
import { exitSearchForceSourceModeEffect, setSearchForceSourceModeEffect } from '../tableState/searchForceSourceMode';
import { exitSourceModeEffect, isEffectiveRawMode, toggleSourceModeEffect } from '../tableState/sourceMode';
import { rebuildAllTableWidgetsEffect, rebuildTableWidgetsEffect } from '../tableState/tableWidgetEffects';
import { sanitizeCellChanges } from '../editorBridge/cellTextCodec';
import { syncAnnotation } from '../editorBridge/syncAnnotation';
import { resolveActiveCell, type ResolvedActiveCell } from './activeCellResolver';
import { isFullDocumentReplace } from '../shared/transactionUtils';
import { isStructuralTableChange } from './structuralChangeDetection';
import { normalizeBeforeEditAnnotation } from './tableNormalization';
import { buildMultiCellPasteRewrite, type TableClipboardRewrite } from './cellSelectionClipboard';
import { buildRootTablePasteRewrite, type RootTablePasteRewrite } from './pasteTableNormalizer';

export interface TableRuntimeSnapshot {
    activeCell: ActiveCell | null;
    prevActiveCell: ActiveCell | null;
    resolvedActiveCell: ResolvedActiveCell | null;
    resolvedPrevActiveCell: ResolvedActiveCell | null;
    effectiveRawMode: boolean;
    nestedEditorOpen: boolean;
    hadActiveCell: boolean;
    pendingFullReplaceRebuild: boolean;
}

export interface TableRuntimeEvent {
    update: ViewUpdate;
    isSync: boolean;
    isNormalizeBeforeEdit: boolean;
    isCellSelectionTransition: boolean;
    forceRebuild: boolean;
    rawModeEffects: RawModeEffects;
    enteredRawMode: boolean;
    exitedRawMode: boolean;
    hasFullDocumentReplace: boolean;
}

export interface RawModeEffects {
    exitedSourceMode: boolean;
    exitedSearchForce: boolean;
    hadRawModeToggle: boolean;
}

export type TableRuntimeAction =
    | { type: 'openNestedEditor'; activeCell: ActiveCell }
    | { type: 'closeNestedEditor'; useResolvedRangeFromUpdate: boolean }
    | { type: 'syncMainDocToNested' }
    | { type: 'syncMainSelectionToNested' }
    | { type: 'clearActiveCell' }
    | {
          type: 'scheduleActivateCellAtCursor';
          clearIfOutside: boolean;
          ensureCursorVisibleIfNotActivated: boolean;
          normalizeIfNeeded: boolean;
      }
    | { type: 'scheduleEnsureCursorVisible'; mode: 'enteredRawMode' | 'exitedRawModeWithoutActiveCell' }
    | { type: 'scheduleRebuildAllAfterFullReplace' };

export type DecorationDecision =
    | { type: 'keepDecorations' }
    | { type: 'noneDecorations' }
    | { type: 'mapDecorations' }
    | { type: 'rebuildAllDecorations' };

export type GuardDecision =
    | { type: 'allowTransaction' }
    | { type: 'rejectTransaction' }
    | { type: 'clearActiveCell'; selection: EditorSelection | undefined }
    | { type: 'rewriteTableClipboard'; rewrite: TableClipboardRewrite }
    | { type: 'rewriteRootTablePaste'; rewrite: RootTablePasteRewrite }
    | {
          type: 'sanitizeTransactionChanges';
          changes: ReturnType<typeof sanitizeCellChanges>['changes'];
          selection: EditorSelection;
      };

function extractSingleInsertedText(tr: Transaction): string | null {
    let insertedText: string | null = null;
    let changeCount = 0;

    tr.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
        changeCount++;
        if (changeCount === 1) {
            insertedText = inserted.toString();
        }
    });

    return changeCount === 1 && insertedText ? insertedText : null;
}

function extractSingleChangeRange(tr: Transaction): { from: number; to: number } | null {
    let changeRange: { from: number; to: number } | null = null;
    let changeCount = 0;

    tr.changes.iterChanges((fromA, toA) => {
        changeCount++;
        if (changeCount === 1) {
            changeRange = { from: fromA, to: toA };
        }
    });

    return changeCount === 1 ? changeRange : null;
}

function scanRawModeEffects(transactions: readonly Transaction[]): RawModeEffects {
    let exitedSourceMode = false;
    let exitedSearchForce = false;
    let hadRawModeToggle = false;

    for (const tr of transactions) {
        for (const effect of tr.effects) {
            if (effect.is(exitSourceModeEffect)) {
                exitedSourceMode = true;
                hadRawModeToggle = true;
            }
            if (effect.is(exitSearchForceSourceModeEffect)) {
                exitedSearchForce = true;
                hadRawModeToggle = true;
            }
            if (effect.is(toggleSourceModeEffect) || effect.is(setSearchForceSourceModeEffect)) {
                hadRawModeToggle = true;
            }
        }
    }

    return { exitedSourceMode, exitedSearchForce, hadRawModeToggle };
}

export function buildTableRuntimeSnapshot(params: {
    update: ViewUpdate;
    nestedEditorOpen: boolean;
    hadActiveCell: boolean;
    pendingFullReplaceRebuild: boolean;
}): TableRuntimeSnapshot {
    const activeCell = getActiveCell(params.update.state);
    const prevActiveCell = getActiveCell(params.update.startState);

    return {
        activeCell,
        prevActiveCell,
        resolvedActiveCell: resolveActiveCell(params.update.state, activeCell),
        resolvedPrevActiveCell: resolveActiveCell(params.update.startState, prevActiveCell),
        effectiveRawMode: isEffectiveRawMode(params.update.state),
        nestedEditorOpen: params.nestedEditorOpen,
        hadActiveCell: params.hadActiveCell,
        pendingFullReplaceRebuild: params.pendingFullReplaceRebuild,
    };
}

export function buildTableRuntimeEvent(update: ViewUpdate, previousEffectiveRawMode: boolean): TableRuntimeEvent {
    const rawModeEffects = scanRawModeEffects(update.transactions);

    return {
        update,
        isSync: update.transactions.some((tr) => Boolean(tr.annotation(syncAnnotation))),
        isNormalizeBeforeEdit: update.transactions.some((tr) => Boolean(tr.annotation(normalizeBeforeEditAnnotation))),
        isCellSelectionTransition: update.transactions.some((tr) =>
            Boolean(tr.annotation(cellSelectionTransitionAnnotation))
        ),
        forceRebuild: update.transactions.some((tr) =>
            tr.effects.some((effect) => effect.is(rebuildTableWidgetsEffect))
        ),
        rawModeEffects,
        enteredRawMode:
            rawModeEffects.hadRawModeToggle && !previousEffectiveRawMode && isEffectiveRawMode(update.state),
        exitedRawMode: rawModeEffects.hadRawModeToggle && previousEffectiveRawMode && !isEffectiveRawMode(update.state),
        hasFullDocumentReplace: update.transactions.some((tr) => isFullDocumentReplace(tr)),
    };
}

function changesOverlapRange(tr: Transaction, from: number, to: number): boolean {
    let overlaps = false;
    tr.changes.iterChanges((fromA, toA) => {
        if (overlaps) {
            return;
        }
        if (fromA < to && toA > from) {
            overlaps = true;
        }
    });
    return overlaps;
}

function transactionChangesOutsideCell(tr: Transaction, activeCell: ResolvedActiveCell): boolean {
    let outsideCell = false;
    tr.changes.iterChanges((fromA, toA) => {
        if (outsideCell) {
            return;
        }
        if (fromA < activeCell.cellFrom || toA > activeCell.cellTo) {
            outsideCell = true;
        }
    });
    return outsideCell;
}

function transactionRequiresTableRebuild(tr: Transaction, activeCell: ResolvedActiveCell | null): boolean {
    if (!activeCell) {
        return false;
    }

    if (!tr.isUserEvent('undo') && !tr.isUserEvent('redo')) {
        return false;
    }

    if (isStructuralTableChange(tr)) {
        return true;
    }

    return transactionChangesOutsideCell(tr, activeCell);
}

export function planTableLifecycleActions(
    snapshot: TableRuntimeSnapshot,
    event: TableRuntimeEvent,
    options: { cursorInsideTableAfterUndoRedo: boolean }
): TableRuntimeAction[] {
    const { update, rawModeEffects } = event;
    const actions: TableRuntimeAction[] = [];

    if (
        snapshot.hadActiveCell &&
        event.hasFullDocumentReplace &&
        !event.isNormalizeBeforeEdit &&
        !snapshot.pendingFullReplaceRebuild
    ) {
        actions.push({ type: 'scheduleRebuildAllAfterFullReplace' });
    }

    if (rawModeEffects.exitedSourceMode || rawModeEffects.exitedSearchForce) {
        actions.push({
            type: 'scheduleActivateCellAtCursor',
            clearIfOutside: false,
            ensureCursorVisibleIfNotActivated: true,
            normalizeIfNeeded: false,
        });
        return actions;
    }

    if (event.enteredRawMode && !event.isCellSelectionTransition) {
        actions.push({ type: 'scheduleEnsureCursorVisible', mode: 'enteredRawMode' });
    }

    if (event.exitedRawMode && !snapshot.activeCell && !event.isCellSelectionTransition) {
        actions.push({ type: 'scheduleEnsureCursorVisible', mode: 'exitedRawModeWithoutActiveCell' });
    }

    if (shouldRepositionCellAfterUndoRedo(snapshot, event, options.cursorInsideTableAfterUndoRedo)) {
        if (snapshot.nestedEditorOpen) {
            actions.push({ type: 'closeNestedEditor', useResolvedRangeFromUpdate: true });
        }
        actions.push({
            type: 'scheduleActivateCellAtCursor',
            clearIfOutside: true,
            ensureCursorVisibleIfNotActivated: false,
            normalizeIfNeeded: false,
        });
        return actions;
    }

    if (event.forceRebuild && snapshot.activeCell && !event.isSync) {
        if (snapshot.nestedEditorOpen) {
            actions.push({ type: 'closeNestedEditor', useResolvedRangeFromUpdate: false });
        }
        actions.push({ type: 'openNestedEditor', activeCell: snapshot.activeCell });
        return actions;
    }

    if (!snapshot.activeCell && snapshot.hadActiveCell) {
        actions.push({ type: 'closeNestedEditor', useResolvedRangeFromUpdate: false });
    }

    if (update.docChanged && snapshot.resolvedActiveCell && snapshot.nestedEditorOpen && !event.isSync) {
        // Doc sync includes selection rebase via rebaseLocalEditorFromRoot,
        // so syncMainSelectionToNested is not needed when doc changed.
        actions.push({ type: 'syncMainDocToNested' });
    } else {
        const sameActiveCell = isSameActiveCell(snapshot.prevActiveCell, snapshot.activeCell);
        if (
            update.selectionSet &&
            sameActiveCell &&
            snapshot.resolvedActiveCell &&
            snapshot.nestedEditorOpen &&
            !event.isSync
        ) {
            actions.push({ type: 'syncMainSelectionToNested' });
        }
    }

    if (update.docChanged && snapshot.activeCell && !snapshot.resolvedActiveCell && !event.isSync) {
        actions.push({ type: 'clearActiveCell' });
    }

    if (update.docChanged && snapshot.resolvedActiveCell && !snapshot.nestedEditorOpen && !event.isSync) {
        actions.push({ type: 'clearActiveCell' });
    }

    return actions;
}

function shouldRepositionCellAfterUndoRedo(
    snapshot: TableRuntimeSnapshot,
    event: TableRuntimeEvent,
    cursorInsideTableAfterUndoRedo: boolean
): boolean {
    const { update, isSync } = event;

    if (!update.docChanged || isSync || snapshot.effectiveRawMode) {
        return false;
    }

    if (snapshot.hadActiveCell && snapshot.resolvedPrevActiveCell) {
        return update.transactions.some((tr) => transactionRequiresTableRebuild(tr, snapshot.resolvedPrevActiveCell));
    }

    const isUndoRedo = update.transactions.some((tr) => tr.isUserEvent('undo') || tr.isUserEvent('redo'));
    return isUndoRedo && cursorInsideTableAfterUndoRedo;
}

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
    const resolvedPrevActiveCell = resolveActiveCell(tr.startState, prevActiveCell);
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

export function decideMainEditorGuardTransaction(
    tr: Transaction,
    params: { nestedEditorOpen: boolean }
): GuardDecision {
    if (!tr.docChanged) {
        return { type: 'allowTransaction' };
    }

    if (tr.annotation(syncAnnotation)) {
        return { type: 'allowTransaction' };
    }

    if (tr.annotation(normalizeBeforeEditAnnotation)) {
        return { type: 'allowTransaction' };
    }

    if (tr.isUserEvent('input.paste')) {
        const pastedText = extractSingleInsertedText(tr);

        if (pastedText) {
            const activeCell = getActiveCell(tr.startState);

            if (params.nestedEditorOpen && activeCell) {
                const rewrite = buildMultiCellPasteRewrite(
                    tr.startState,
                    {
                        tableFrom: activeCell.tableFrom,
                        anchor: {
                            section: activeCell.section,
                            row: activeCell.row,
                            col: activeCell.col,
                        },
                        source: 'activeCell',
                    },
                    pastedText
                );

                if (rewrite) {
                    return { type: 'rewriteTableClipboard', rewrite };
                }
            }

            if (!params.nestedEditorOpen && !getCellSelection(tr.startState) && !isEffectiveRawMode(tr.startState)) {
                const changeRange = extractSingleChangeRange(tr);
                if (changeRange) {
                    const rewrite = buildRootTablePasteRewrite(
                        tr.startState,
                        changeRange.from,
                        changeRange.to,
                        pastedText
                    );

                    if (rewrite) {
                        return { type: 'rewriteRootTablePaste', rewrite };
                    }
                }
            }
        }
    }

    const activeCell = getActiveCell(tr.startState);
    const resolvedActiveCell = resolveActiveCell(tr.startState, activeCell);
    if (isFullDocumentReplace(tr)) {
        return activeCell
            ? { type: 'clearActiveCell', selection: tr.selection ?? undefined }
            : { type: 'allowTransaction' };
    }

    if (!params.nestedEditorOpen || !activeCell) {
        return { type: 'allowTransaction' };
    }

    if (!resolvedActiveCell) {
        return { type: 'clearActiveCell', selection: tr.selection ?? undefined };
    }

    if (tr.effects.some((effect) => effect.is(rebuildTableWidgetsEffect))) {
        return { type: 'allowTransaction' };
    }

    if (!changesOverlapRange(tr, resolvedActiveCell.tableFrom, resolvedActiveCell.tableTo)) {
        return { type: 'allowTransaction' };
    }

    const sanitized = sanitizeCellChanges(tr, resolvedActiveCell.cellFrom, resolvedActiveCell.cellTo);
    if (sanitized.rejected) {
        return { type: 'rejectTransaction' };
    }

    if (!sanitized.didModifyInserts) {
        return { type: 'allowTransaction' };
    }

    const changeSet = ChangeSet.of(sanitized.changes, tr.startState.doc.length);
    const selection = EditorSelection.create(
        tr.startState.selection.ranges.map((range) => mapSelectionRange(range, changeSet)),
        tr.startState.selection.mainIndex
    );

    return {
        type: 'sanitizeTransactionChanges',
        changes: sanitized.changes,
        selection,
    };
}

function mapSelectionRange(range: SelectionRange, changeSet: ChangeSet): SelectionRange {
    return EditorSelection.range(changeSet.mapPos(range.anchor, 1), changeSet.mapPos(range.head, 1));
}
