export {
    buildTableRuntimeEvent,
    buildTableRuntimeSnapshot,
    mapSelectionRange,
    planTableLifecycleActions,
    transactionRequiresTableRebuild,
    type RawModeEffects,
    type TableRuntimeAction,
    type TableRuntimeEvent,
    type TableRuntimeSnapshot,
} from './lifecycle/lifecyclePolicy';
export { decideMainEditorGuardTransaction, type GuardDecision } from '../editorBridge/mainEditorGuardPolicy';
export { decideTableDecorationUpdate, type DecorationDecision } from '../tableWidget/tableDecorationPolicy';
