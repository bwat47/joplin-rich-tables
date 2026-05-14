import { describe, expect, it } from '@jest/globals';
import type { EditorState, StateEffect, TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { insertTableAndActivate } from '../tableRuntime/operations/structuralOperations';
import { activateInsertedTableEffect } from '../tableState/insertedTableActivation';
import { createMarkdownState } from './testMarkdownState';

const DEFAULT_INSERTED_TABLE_MARKDOWN = ['|  |  |', '| --- | --- |', '|  |  |'].join('\n');

interface CapturedDispatch {
    spec: TransactionSpec;
    effects: StateEffect<unknown>[];
}

function createMockView(doc: string, cursorPos: number): EditorView & { state: EditorState } {
    const dispatches: CapturedDispatch[] = [];
    const view = {
        state: createMarkdownState(doc).update({ selection: { anchor: cursorPos } }).state,
        get dispatches() {
            return dispatches;
        },
        dispatch(spec: TransactionSpec) {
            const effects: StateEffect<unknown>[] = Array.isArray(spec.effects)
                ? (spec.effects as StateEffect<unknown>[])
                : spec.effects
                  ? [spec.effects as StateEffect<unknown>]
                  : [];
            dispatches.push({ spec, effects });
            this.state = this.state.update(spec).state;
        },
    };

    return view as unknown as EditorView & { state: EditorState };
}

function getActivateInsertedTableEffect(
    view: ReturnType<typeof createMockView>
): { tableFrom: number; target: unknown } | null {
    for (const { effects } of (view as unknown as { dispatches: CapturedDispatch[] }).dispatches) {
        for (const effect of effects) {
            if (effect.is(activateInsertedTableEffect)) {
                return effect.value;
            }
        }
    }
    return null;
}

describe('insertTableAndActivate', () => {
    it('reuses isolated block insertion behavior on a whitespace-only line', () => {
        const doc = ['before', '', 'after'].join('\n');
        const view = createMockView(doc, 'before\n'.length);

        insertTableAndActivate(view);

        expect(view.state.doc.toString()).toBe(
            ['before', '', ...DEFAULT_INSERTED_TABLE_MARKDOWN.split('\n'), '', 'after'].join('\n')
        );
        expect(view.state.selection.main.head).toBe(10);

        const activationEffect = getActivateInsertedTableEffect(view);
        expect(activationEffect).toEqual({
            tableFrom: 8,
            target: { section: 'header', row: 0, col: 0 },
        });
    });

    it('produces canonical markdown with blank lines when inserting mid-line', () => {
        const doc = 'before after';
        const cursorPos = doc.indexOf(' ');
        const view = createMockView(doc, cursorPos);

        insertTableAndActivate(view);

        expect(view.state.doc.toString()).toBe(`before\n\n${DEFAULT_INSERTED_TABLE_MARKDOWN}\n\n after`);
        expect(view.state.selection.main.head).toBe(10);

        const activationEffect = getActivateInsertedTableEffect(view);
        expect(activationEffect).toEqual({
            tableFrom: 8,
            target: { section: 'header', row: 0, col: 0 },
        });
    });

    it('keeps empty-document insertion aligned with root paste behavior', () => {
        const view = createMockView('', 0);

        insertTableAndActivate(view);

        expect(view.state.doc.toString()).toBe(`\n${DEFAULT_INSERTED_TABLE_MARKDOWN}\n`);
        expect(view.state.selection.main.head).toBe(3);

        const activationEffect = getActivateInsertedTableEffect(view);
        expect(activationEffect).toEqual({
            tableFrom: 1,
            target: { section: 'header', row: 0, col: 0 },
        });
    });
});
