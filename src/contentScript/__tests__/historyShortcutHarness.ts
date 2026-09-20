import { history, isolateHistory, undo } from '@codemirror/commands';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, keymap, runScopeHandlers } from '@codemirror/view';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNestedEditorKeymap } from '../nestedEditor/domHandlers';
import { isNestedEditorOpen, openNestedEditor } from '../nestedEditor/nestedEditorController';
import { getActiveCell, setActiveCellEffect } from '../tableState/activeCellState';
import { getCellSelection, setCellSelectionEffect } from '../tableState/cellSelectionState';
import { startCellDragEffect } from '../tableState/cellDragState';
import { syncAnnotation } from '../editorBridge/syncAnnotation';
import { getResolvedActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import { findCellElement } from '../tableWidget/domHelpers';
import { requireResolvedActiveCell } from './testUtils';
import {
    TEST_HOST_CONFIG,
    cellSelectionTestExtensions,
    createFrameQueue,
    installRangeLayoutStubs,
    nestedEditorTestExtensions,
} from './tableEditorFixtures';
import type { SimulatedPlatform } from './historyShortcutNavigator';

type HistoryAction = 'undo' | 'redo';

interface ShortcutCase {
    label: string;
    init: KeyboardEventInit & { key: string };
    action: HistoryAction;
}

interface RejectedShortcutCase {
    label: string;
    init: KeyboardEventInit & { key: string };
}

const SUPPORTED: Record<SimulatedPlatform, ShortcutCase[]> = {
    macOS: [
        { label: 'Cmd-Z', init: { key: 'z', metaKey: true }, action: 'undo' },
        { label: 'Cmd-Shift-Z', init: { key: 'z', metaKey: true, shiftKey: true }, action: 'redo' },
    ],
    Windows: [
        { label: 'Ctrl-Z', init: { key: 'z', ctrlKey: true }, action: 'undo' },
        { label: 'Ctrl-Y', init: { key: 'y', ctrlKey: true }, action: 'redo' },
    ],
    Linux: [
        { label: 'Ctrl-Z', init: { key: 'z', ctrlKey: true }, action: 'undo' },
        { label: 'Ctrl-Y', init: { key: 'y', ctrlKey: true }, action: 'redo' },
        { label: 'Ctrl-Shift-Z', init: { key: 'z', ctrlKey: true, shiftKey: true }, action: 'redo' },
    ],
};

/**
 * Chords this platform must ignore even though another platform binds them, or the
 * pre-refactor matcher accepted them. Modifier noise that no platform binds lives in
 * `REJECTED_EVERYWHERE` instead.
 */
const REJECTED: Record<SimulatedPlatform, RejectedShortcutCase[]> = {
    macOS: [
        { label: 'Cmd-Y', init: { key: 'y', metaKey: true } },
        { label: 'Ctrl-Shift-Z', init: { key: 'z', ctrlKey: true, shiftKey: true } },
        { label: 'Ctrl-Z', init: { key: 'z', ctrlKey: true } },
    ],
    Windows: [
        { label: 'Ctrl-Shift-Z', init: { key: 'z', ctrlKey: true, shiftKey: true } },
        { label: 'Cmd-Z', init: { key: 'z', metaKey: true } },
    ],
    Linux: [
        { label: 'Cmd-Z', init: { key: 'z', metaKey: true } },
        { label: 'Cmd-Shift-Z', init: { key: 'z', metaKey: true, shiftKey: true } },
    ],
};

/**
 * Modifier combinations no platform binds. Rejecting them is CodeMirror's exact-match
 * key normalization rather than anything platform-specific, so one platform covers it.
 */
const REJECTED_EVERYWHERE: RejectedShortcutCase[] = [
    { label: 'Alt-Ctrl-Z', init: { key: 'z', ctrlKey: true, altKey: true } },
    { label: 'Ctrl-Shift-Y', init: { key: 'y', ctrlKey: true, shiftKey: true } },
    { label: 'Ctrl+Meta-Z', init: { key: 'z', ctrlKey: true, metaKey: true } },
];

/** The keymap platform each simulated platform must resolve to. */
const EXPECTED_KEYMAP_PLATFORM: Record<SimulatedPlatform, string> = {
    macOS: 'mac',
    Windows: 'win',
    Linux: 'linux',
};

/** Each field name is the keymap platform that selects it, so the key that fires names it. */
const PLATFORM_PROBE_BINDING = { key: 'F13', mac: 'F14', win: 'F15', linux: 'F16' } as const;

/**
 * The platform `@codemirror/view` snapshotted when it loaded, read back through the only thing
 * that observes it: which field of a key binding the keymap resolves.
 *
 * Reading `navigator` instead would prove nothing. The stub's `defineProperty` succeeds whether
 * it lands before or after CodeMirror read the platform, so `navigator.platform` reports the
 * simulated value either way - including when the import order this file depends on has broken.
 * Returns `'key'` when no stub reached CodeMirror, which is what bare jsdom resolves to.
 */
function detectKeymapPlatform(): string {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
        parent,
        state: EditorState.create({
            extensions: keymap.of([{ ...PLATFORM_PROBE_BINDING, run: () => true }]),
        }),
    });

    try {
        for (const [keymapPlatform, key] of Object.entries(PLATFORM_PROBE_BINDING)) {
            if (runScopeHandlers(view, new KeyboardEvent('keydown', { key, bubbles: true }), 'editor')) {
                return keymapPlatform;
            }
        }
        return 'unresolved';
    } finally {
        view.destroy();
        parent.remove();
    }
}

const TABLE_DOC = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
const FIRST_EDIT = '\n#one';
const SECOND_EDIT = '\n#two';
installRangeLayoutStubs();

function pressKey(target: EventTarget, init: KeyboardEventInit & { key: string }): KeyboardEvent {
    const letter = init.key.toLowerCase();
    const key = init.shiftKey ? letter.toUpperCase() : letter;
    const event = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ...init,
        key,
    });
    let keyCode = 0;
    if (letter === 'z') {
        keyCode = 90;
    } else if (letter === 'y') {
        keyCode = 89;
    }
    Object.defineProperty(event, 'keyCode', { get: () => keyCode });
    target.dispatchEvent(event);
    return event;
}

function appendHistoryEntry(view: EditorView, text: string): void {
    view.dispatch({
        changes: { from: view.state.doc.length, insert: text },
        annotations: isolateHistory.of('full'),
    });
}

function primeTwoEdits(view: EditorView): void {
    appendHistoryEntry(view, FIRST_EDIT);
    appendHistoryEntry(view, SECOND_EDIT);
}

function createHistoryCounter(): {
    extension: ReturnType<typeof EditorView.updateListener.of>;
    events: HistoryAction[];
} {
    const events: HistoryAction[] = [];
    return {
        events,
        extension: EditorView.updateListener.of((update) => {
            for (const transaction of update.transactions) {
                if (transaction.isUserEvent('undo')) {
                    events.push('undo');
                }
                if (transaction.isUserEvent('redo')) {
                    events.push('redo');
                }
            }
        }),
    };
}

function typeIntoFocusedEditor(text: string): void {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) {
        throw new Error('Expected an HTML focus target');
    }

    const view = EditorView.findFromDOM(active);
    if (!view) {
        throw new Error('Expected a CodeMirror editor to own focus');
    }

    const from = view.state.selection.main.from;
    view.dispatch({
        changes: { from, insert: text },
        selection: { anchor: from + text.length },
        userEvent: 'input.type',
    });
}

export function registerHistoryShortcutTests(
    platform: SimulatedPlatform,
    options: { includeSharedBehavior?: boolean } = {}
): void {
    const mountedViews: EditorView[] = [];

    /**
     * Fails the whole file when the platform stub did not reach CodeMirror, rather than letting
     * every keybinding case below fail under a misleading name.
     */
    beforeAll(() => {
        expect(detectKeymapPlatform()).toBe(EXPECTED_KEYMAP_PLATFORM[platform]);
    });

    afterEach(() => {
        while (mountedViews.length > 0) {
            mountedViews.pop()?.destroy();
        }
        document.body.replaceChildren();
    });

    function trackView(view: EditorView): EditorView {
        mountedViews.push(view);
        return view;
    }

    function mountMainHistoryView(): { view: EditorView; historyCounter: ReturnType<typeof createHistoryCounter> } {
        const parent = document.createElement('div');
        document.body.appendChild(parent);
        const historyCounter = createHistoryCounter();
        const view = trackView(
            new EditorView({
                parent,
                doc: 'base',
                extensions: [history(), historyCounter.extension],
            })
        );
        primeTwoEdits(view);
        return { view, historyCounter };
    }

    function mountNestedKeymap(mainView: EditorView): EditorView {
        const parent = document.createElement('div');
        document.body.appendChild(parent);
        const view = trackView(
            new EditorView({
                parent,
                doc: 'cell',
                extensions: [
                    createNestedEditorKeymap(mainView, {
                        getSelectionBounds: (nestedView) => ({ from: 0, to: nestedView.state.doc.length }),
                        closeEditor: vi.fn(),
                        syncPendingChangesToRoot: vi.fn(),
                    }),
                ],
            })
        );
        view.contentDOM.focus();
        return view;
    }

    function mountSelectionView(): { view: EditorView; historyCounter: ReturnType<typeof createHistoryCounter> } {
        const parent = document.createElement('div');
        document.body.appendChild(parent);
        const historyCounter = createHistoryCounter();
        const view = trackView(
            new EditorView({
                parent,
                doc: TABLE_DOC,
                extensions: cellSelectionTestExtensions(history(), historyCounter.extension),
            })
        );
        return { view, historyCounter };
    }

    function selectBodyCells(view: EditorView): void {
        view.dispatch({
            effects: setCellSelectionEffect.of({
                tableFrom: 0,
                anchor: { section: 'body', row: 0, col: 0 },
                focus: { section: 'body', row: 0, col: 1 },
            }),
        });
    }

    it.each(SUPPORTED[platform])('nested $label changes root history exactly once', ({ init, action }) => {
        const { view: mainView, historyCounter } = mountMainHistoryView();
        const nestedView = mountNestedKeymap(mainView);

        if (action === 'redo') {
            expect(undo(mainView)).toBe(true);
            historyCounter.events.length = 0;
        }

        const event = pressKey(nestedView.contentDOM, init);

        expect(event.defaultPrevented).toBe(true);
        if (action === 'undo') {
            expect(mainView.state.doc.toString()).toBe(`base${FIRST_EDIT}`);
            expect(historyCounter.events).toEqual(['undo']);
        } else {
            expect(mainView.state.doc.toString()).toBe(`base${FIRST_EDIT}${SECOND_EDIT}`);
            expect(historyCounter.events).toEqual(['redo']);
        }
    });

    function expectNestedShortcutIgnored(init: KeyboardEventInit & { key: string }): void {
        const { view: mainView, historyCounter } = mountMainHistoryView();
        const nestedView = mountNestedKeymap(mainView);
        const before = mainView.state.doc.toString();

        const event = pressKey(nestedView.contentDOM, init);

        expect(event.defaultPrevented).toBe(false);
        expect(mainView.state.doc.toString()).toBe(before);
        expect(historyCounter.events).toEqual([]);
    }

    function expectSelectionShortcutIgnored(init: KeyboardEventInit & { key: string }): void {
        const { view, historyCounter } = mountSelectionView();
        primeTwoEdits(view);
        selectBodyCells(view);
        const before = view.state.doc.toString();

        const event = pressKey(document.body, init);

        expect(event.defaultPrevented).toBe(false);
        expect(view.state.doc.toString()).toBe(before);
        expect(historyCounter.events).toEqual([]);
        expect(getCellSelection(view.state)).not.toBeNull();
    }

    it.each(REJECTED[platform])('nested $label does not change root history', ({ init }) => {
        expectNestedShortcutIgnored(init);
    });

    it.each(SUPPORTED[platform])('cell selection $label changes root history exactly once', ({ init, action }) => {
        const { view, historyCounter } = mountSelectionView();
        primeTwoEdits(view);

        if (action === 'redo') {
            expect(undo(view)).toBe(true);
            historyCounter.events.length = 0;
        }

        selectBodyCells(view);
        expect(getCellSelection(view.state)).not.toBeNull();

        const event = pressKey(document.body, init);

        expect(event.defaultPrevented).toBe(true);
        // The rewritten document invalidates the cell coordinates the highlight was anchored to.
        expect(getCellSelection(view.state)).toBeNull();
        if (action === 'undo') {
            expect(view.state.doc.toString()).toBe(`${TABLE_DOC}${FIRST_EDIT}`);
            expect(historyCounter.events).toEqual(['undo']);
        } else {
            expect(view.state.doc.toString()).toBe(`${TABLE_DOC}${FIRST_EDIT}${SECOND_EDIT}`);
            expect(historyCounter.events).toEqual(['redo']);
        }
    });

    it.each(REJECTED[platform])('cell selection $label does not change root history', ({ init }) => {
        expectSelectionShortcutIgnored(init);
    });

    // Nothing below depends on the simulated platform, so one platform file runs it.
    if (!options.includeSharedBehavior) {
        return;
    }

    it.each(REJECTED_EVERYWHERE)('nested $label does not change root history', ({ init }) => {
        expectNestedShortcutIgnored(init);
    });

    it.each(REJECTED_EVERYWHERE)('cell selection $label does not change root history', ({ init }) => {
        expectSelectionShortcutIgnored(init);
    });

    it('keeps scoped history bindings out of the root editor keyboard scope', () => {
        const { view, historyCounter } = mountSelectionView();
        primeTwoEdits(view);
        view.focus();

        const event = pressKey(view.contentDOM, SUPPORTED[platform][0].init);

        expect(event.defaultPrevented).toBe(false);
        expect(view.state.doc.toString()).toBe(`${TABLE_DOC}${FIRST_EDIT}${SECOND_EDIT}`);
        expect(historyCounter.events).toEqual([]);
    });

    it('does not move focus when cell-selection undo has empty history', () => {
        const { view } = mountSelectionView();
        selectBodyCells(view);
        const focusSpy = vi.spyOn(view, 'focus');
        const undoShortcut = SUPPORTED[platform].find((shortcut) => shortcut.action === 'undo');
        if (!undoShortcut) {
            throw new Error('Expected an undo shortcut for the simulated platform');
        }

        const event = pressKey(document.body, undoShortcut.init);

        expect(event.defaultPrevented).toBe(true);
        expect(focusSpy).not.toHaveBeenCalled();
        expect(view.state.doc.toString()).toBe(TABLE_DOC);
    });

    it('yields cell-selection history capture while a drag is in progress', () => {
        const { view, historyCounter } = mountSelectionView();
        primeTwoEdits(view);
        selectBodyCells(view);
        view.dispatch({ effects: startCellDragEffect.of(undefined) });

        const event = pressKey(document.body, SUPPORTED[platform][0].init);

        expect(event.defaultPrevented).toBe(false);
        expect(view.state.doc.toString()).toBe(`${TABLE_DOC}${FIRST_EDIT}${SECOND_EDIT}`);
        expect(historyCounter.events).toEqual([]);
    });

    it('yields cell-selection history capture while an external control owns focus', () => {
        const { view, historyCounter } = mountSelectionView();
        primeTwoEdits(view);
        selectBodyCells(view);

        const externalInput = document.createElement('input');
        document.body.appendChild(externalInput);
        externalInput.focus();

        const event = pressKey(externalInput, SUPPORTED[platform][0].init);

        expect(event.defaultPrevented).toBe(false);
        expect(view.state.doc.toString()).toBe(`${TABLE_DOC}${FIRST_EDIT}${SECOND_EDIT}`);
        expect(historyCounter.events).toEqual([]);
    });

    describe('nested editor history lifecycle via shortcuts', () => {
        const frames = createFrameQueue();

        beforeEach(() => {
            frames.install();
        });

        function mountLifecycleView(doc: string, selectionAnchor: number): EditorView {
            const parent = document.createElement('div');
            document.body.appendChild(parent);
            return trackView(
                new EditorView({
                    parent,
                    state: EditorState.create({
                        doc,
                        selection: EditorSelection.single(selectionAnchor),
                        extensions: nestedEditorTestExtensions(history()),
                    }),
                })
            );
        }

        async function openBodyCell(view: EditorView, tableFrom: number): Promise<HTMLElement> {
            const activeCell = { tableFrom, section: 'body' as const, row: 0, col: 0 };
            view.dispatch({ effects: setActiveCellEffect.of(activeCell) });
            const cellElement = findCellElement(view, tableFrom, activeCell);
            if (!cellElement) {
                throw new Error('Expected a body cell element');
            }

            expect(
                openNestedEditor({
                    mainView: view,
                    resolvedCell: requireResolvedActiveCell(view.state),
                    cellElement,
                    featureSettings: TEST_HOST_CONFIG.nestedEditor,
                })
            ).toBe(true);
            expect(isNestedEditorOpen(view)).toBe(true);
            return cellElement;
        }

        it('keeps editable focus after undo and redo inside a surviving cell', async () => {
            const doc = ['| H1 |', '| --- |', '| abc |'].join('\n');
            const view = mountLifecycleView(doc, doc.indexOf('abc') + 'abc'.length);
            await openBodyCell(view, 0);

            const resolved = getResolvedActiveCell(view.state);
            if (!resolved) {
                throw new Error('Expected the active cell to resolve');
            }

            view.dispatch({
                changes: { from: resolved.editableFrom, to: resolved.editableTo, insert: 'typed' },
                selection: EditorSelection.single(resolved.editableFrom + 'typed'.length),
                annotations: syncAnnotation.of(true),
            });

            const undoShortcut = SUPPORTED[platform].find((shortcut) => shortcut.action === 'undo');
            const redoShortcut = SUPPORTED[platform].find((shortcut) => shortcut.action === 'redo');
            if (!undoShortcut || !redoShortcut) {
                throw new Error('Expected undo and redo shortcuts for the simulated platform');
            }

            const event = pressKey(document.activeElement ?? view.contentDOM, undoShortcut.init);
            expect(event.defaultPrevented).toBe(true);
            await frames.flush();

            expect(view.state.doc.toString()).toContain('| abc |');
            expect(isNestedEditorOpen(view)).toBe(true);
            expect(getActiveCell(view.state)).toMatchObject({ tableFrom: 0, section: 'body', row: 0, col: 0 });
            expect(EditorView.findFromDOM(document.activeElement as HTMLElement)).not.toBe(view);

            const redoEvent = pressKey(document.activeElement ?? view.contentDOM, redoShortcut.init);
            expect(redoEvent.defaultPrevented).toBe(true);
            await frames.flush();

            expect(view.state.doc.toString()).toContain('| typed |');
            expect(isNestedEditorOpen(view)).toBe(true);
            typeIntoFocusedEditor('Y');
            expect(view.state.doc.toString()).toContain('| typedY |');
        });

        it('closes the nested editor and restores the main caret when undo removes the table', async () => {
            const intro = 'intro';
            const table = ['| H1 |', '| --- |', '| abc |'].join('\n');
            const view = mountLifecycleView(intro, intro.length);
            view.dispatch({
                changes: { from: intro.length, insert: `\n\n${table}` },
            });

            const tableFrom = view.state.doc.toString().indexOf(table);
            await openBodyCell(view, tableFrom);
            const undoShortcut = SUPPORTED[platform].find((shortcut) => shortcut.action === 'undo');
            if (!undoShortcut) {
                throw new Error('Expected an undo shortcut for the simulated platform');
            }

            const event = pressKey(document.activeElement ?? view.contentDOM, undoShortcut.init);
            expect(event.defaultPrevented).toBe(true);
            await frames.flush();

            expect(view.state.doc.toString()).toBe(intro);
            expect(isNestedEditorOpen(view)).toBe(false);
            expect(getActiveCell(view.state)).toBeNull();

            typeIntoFocusedEditor('X');
            expect(view.state.doc.toString()).toBe(`${intro}X`);
        });
    });
}
