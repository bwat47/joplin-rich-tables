import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest';
import type { EditorState, StateEffect, TransactionSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { insertTableAndActivate } from '../tableRuntime/operations/structuralOperations';
import { planCellEntryNormalization } from '../tableRuntime/tableCanonicalForm';
import {
    beginOpenCellRequestEffect,
    getPendingOpenCellRequest,
    openCellRequestField,
    triggerOpenCellRequestEffect,
} from '../tableRuntime/openCellRequest';
import { activeCellField } from '../tableState/activeCellState';
import { getTableContextAtPos } from '../tableState/tableContextField';
import { findCellElement } from '../tableWidget/domHelpers';
import { tableDecorationField } from '../tableWidget/tableDecorationField';
import { createMarkdownState } from './testMarkdownState';
import { createResizeObserverStub } from './tableEditorFixtures';

const resizeObserver = createResizeObserverStub();

const DEFAULT_INSERTED_TABLE_MARKDOWN = ['|  |  |', '| --- | --- |', '|  |  |'].join('\n');
const INSERTED_TABLE_HEADER_CELL = { section: 'header', row: 0, col: 0 } as const;

interface CapturedDispatch {
    spec: TransactionSpec;
    effects: StateEffect<unknown>[];
}

function toEffectArray(effects: TransactionSpec['effects']): StateEffect<unknown>[] {
    if (!effects) return [];
    return Array.isArray(effects) ? [...(effects as StateEffect<unknown>[])] : [effects as StateEffect<unknown>];
}

function createMockView(doc: string, cursorPos: number): EditorView & { state: EditorState } {
    const dispatches: CapturedDispatch[] = [];
    const view = {
        state: createMarkdownState(doc).update({ selection: { anchor: cursorPos } }).state,
        get dispatches() {
            return dispatches;
        },
        dispatch(spec: TransactionSpec) {
            dispatches.push({ spec, effects: toEffectArray(spec.effects) });
            this.state = this.state.update(spec).state;
        },
    };

    return view as unknown as EditorView & { state: EditorState };
}

function expectInsertOpenCellRequest(view: ReturnType<typeof createMockView>, tableFrom: number): void {
    let begin: ReturnType<typeof beginOpenCellRequestEffect.of>['value'] | null = null;
    let trigger: ReturnType<typeof triggerOpenCellRequestEffect.of>['value'] | null = null;

    for (const { effects } of (view as unknown as { dispatches: CapturedDispatch[] }).dispatches) {
        for (const effect of effects) {
            if (effect.is(beginOpenCellRequestEffect)) {
                begin = effect.value;
            } else if (effect.is(triggerOpenCellRequestEffect)) {
                trigger = effect.value;
            }
        }
    }

    expect(begin).toMatchObject({
        activeCell: { tableFrom, ...INSERTED_TABLE_HEADER_CELL },
        suppressKeys: true,
    });
    expect(trigger).toEqual({ requestId: begin?.requestId });
}

function expectCellEntryWouldNotRewrite(view: ReturnType<typeof createMockView>, tableFrom: number): void {
    const ctx = getTableContextAtPos(view.state, tableFrom);
    expect(ctx).not.toBeNull();
    expect(
        planCellEntryNormalization({
            state: view.state,
            ctx: ctx!,
            coords: INSERTED_TABLE_HEADER_CELL,
        })
    ).toBeNull();
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

        expectInsertOpenCellRequest(view, 8);
        expectCellEntryWouldNotRewrite(view, 8);
    });

    it('produces canonical markdown with blank lines when inserting mid-line', () => {
        const doc = 'before after';
        const cursorPos = doc.indexOf(' ');
        const view = createMockView(doc, cursorPos);

        insertTableAndActivate(view);

        expect(view.state.doc.toString()).toBe(`before\n\n${DEFAULT_INSERTED_TABLE_MARKDOWN}\n\n after`);
        expect(view.state.selection.main.head).toBe(10);

        expectInsertOpenCellRequest(view, 8);
        expectCellEntryWouldNotRewrite(view, 8);
    });

    it.each([
        {
            label: 'an empty document',
            doc: '',
            cursorPos: 0,
            expectedDoc: `\n${DEFAULT_INSERTED_TABLE_MARKDOWN}\n`,
            tableFrom: 1,
        },
        {
            label: 'a single newline',
            doc: '\n',
            cursorPos: 0,
            expectedDoc: `\n${DEFAULT_INSERTED_TABLE_MARKDOWN}\n`,
            tableFrom: 1,
        },
        {
            label: 'two newlines',
            doc: '\n\n',
            cursorPos: 0,
            expectedDoc: `\n${DEFAULT_INSERTED_TABLE_MARKDOWN}\n\n`,
            tableFrom: 1,
        },
        {
            label: 'the start of a paragraph',
            doc: 'hello',
            cursorPos: 0,
            expectedDoc: `\n${DEFAULT_INSERTED_TABLE_MARKDOWN}\n\nhello`,
            tableFrom: 1,
        },
        {
            label: 'the end of a paragraph',
            doc: 'hello',
            cursorPos: 5,
            expectedDoc: `hello\n\n${DEFAULT_INSERTED_TABLE_MARKDOWN}\n`,
            tableFrom: 7,
        },
    ])('inserts a canonically padded table into $label', ({ doc, cursorPos, expectedDoc, tableFrom }) => {
        const view = createMockView(doc, cursorPos);

        insertTableAndActivate(view);

        expect(view.state.doc.toString()).toBe(expectedDoc);
        expect(view.state.selection.main.head).toBe(tableFrom + 2);

        expectInsertOpenCellRequest(view, tableFrom);
        expectCellEntryWouldNotRewrite(view, tableFrom);
    });

    describe('mounted widget', () => {
        beforeEach(() => {
            resizeObserver.install();
        });

        afterEach(() => {
            vi.unstubAllGlobals();
            document.body.innerHTML = '';
        });

        it('resolves the new cell and leaves the open request pending without a frame', () => {
            const parent = document.createElement('div');
            document.body.appendChild(parent);
            const view = new EditorView({
                parent,
                state: createMarkdownState('', [activeCellField, openCellRequestField, tableDecorationField]),
            });

            insertTableAndActivate(view);

            const request = getPendingOpenCellRequest(view.state);
            expect(request).toMatchObject({
                activeCell: { tableFrom: 1, ...INSERTED_TABLE_HEADER_CELL },
                suppressKeys: true,
            });
            expect(findCellElement(view, request!.activeCell.tableFrom, request!.activeCell)).not.toBeNull();

            view.destroy();
        });
    });
});
