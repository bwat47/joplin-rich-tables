import { history, isolateHistory, undo } from '@codemirror/commands';
import { EditorSelection, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, runScopeHandlers } from '@codemirror/view';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNestedEditorDomHandlers, createNestedEditorKeymap } from '../nestedEditor/domHandlers';
import { isNestedEditorOpen, openNestedEditor } from '../nestedEditor/nestedEditorController';
import { activeCellField, getActiveCell, setActiveCellEffect } from '../tableState/activeCellState';
import { getCellSelection, setCellSelectionEffect } from '../tableState/cellSelectionState';
import { startCellDragEffect } from '../tableState/cellDragState';
import { syncAnnotation } from '../editorBridge/syncAnnotation';
import { getResolvedActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import { findCellElement } from '../tableWidget/domHelpers';
import { isNestedEditorOwnedEvent } from '../nestedEditor/nestedEditorEventRouting';
import { CLASS_CELL_EDITOR } from '../shared/tableDomClasses';
import { requireResolvedActiveCell } from './testUtils';
import {
    TEST_HOST_CONFIG,
    cellSelectionTestExtensions,
    createFrameQueue,
    installRangeLayoutStubs,
    nestedEditorTestExtensions,
} from './tableEditorFixtures';
import type { SimulatedPlatform } from './keymapPlatformNavigator';

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

interface KeyCase {
    label: string;
    init: KeyboardEventInit & { key: string };
}

const WINDOWS_LINUX_DELETION: KeyCase[] = [
    { label: 'Ctrl-Backspace', init: { key: 'Backspace', ctrlKey: true } },
    { label: 'Ctrl-Delete', init: { key: 'Delete', ctrlKey: true } },
    { label: 'Ctrl-Shift-K', init: { key: 'k', ctrlKey: true, shiftKey: true } },
];

const DELETION_SUPPORTED: Record<SimulatedPlatform, KeyCase[]> = {
    macOS: [
        { label: 'Option-Backspace', init: { key: 'Backspace', altKey: true } },
        { label: 'Option-Delete', init: { key: 'Delete', altKey: true } },
        { label: 'Cmd-Backspace', init: { key: 'Backspace', metaKey: true } },
        { label: 'Cmd-Delete', init: { key: 'Delete', metaKey: true } },
        { label: 'Ctrl-D', init: { key: 'd', ctrlKey: true } },
        { label: 'Ctrl-H', init: { key: 'h', ctrlKey: true } },
        { label: 'Ctrl-K', init: { key: 'k', ctrlKey: true } },
        { label: 'Ctrl-Option-H', init: { key: 'h', ctrlKey: true, altKey: true } },
        { label: 'Cmd-Shift-K', init: { key: 'k', metaKey: true, shiftKey: true } },
    ],
    Windows: WINDOWS_LINUX_DELETION,
    Linux: WINDOWS_LINUX_DELETION,
};

const WINDOWS_LINUX_DELETION_REJECTED: KeyCase[] = [
    { label: 'Cmd-Backspace', init: { key: 'Backspace', metaKey: true } },
    { label: 'Option-Backspace', init: { key: 'Backspace', altKey: true } },
    { label: 'Ctrl-D', init: { key: 'd', ctrlKey: true } },
    { label: 'Cmd-Shift-K', init: { key: 'k', metaKey: true, shiftKey: true } },
];

const DELETION_REJECTED: Record<SimulatedPlatform, KeyCase[]> = {
    macOS: [
        { label: 'Ctrl-Backspace', init: { key: 'Backspace', ctrlKey: true } },
        { label: 'Ctrl-Delete', init: { key: 'Delete', ctrlKey: true } },
        { label: 'Ctrl-Shift-K', init: { key: 'k', ctrlKey: true, shiftKey: true } },
    ],
    Windows: WINDOWS_LINUX_DELETION_REJECTED,
    Linux: WINDOWS_LINUX_DELETION_REJECTED,
};

const DELETION_REJECTED_EVERYWHERE: KeyCase[] = [
    { label: 'Alt-Ctrl-Backspace', init: { key: 'Backspace', ctrlKey: true, altKey: true } },
    { label: 'Ctrl-Shift-Delete', init: { key: 'Delete', ctrlKey: true, shiftKey: true } },
    { label: 'Ctrl+Meta-Backspace', init: { key: 'Backspace', ctrlKey: true, metaKey: true } },
];

const WINDOWS_LINUX_SEARCH: KeyCase[] = [{ label: 'Ctrl-F', init: { key: 'f', ctrlKey: true } }];
const WINDOWS_LINUX_FORMATTING: KeyCase[] = [
    { label: 'Ctrl-B', init: { key: 'b', ctrlKey: true } },
    { label: 'Ctrl-I', init: { key: 'i', ctrlKey: true } },
    { label: 'Ctrl-U', init: { key: 'u', ctrlKey: true } },
    { label: 'Ctrl-`', init: { key: '`', ctrlKey: true } },
    { label: 'Ctrl-E', init: { key: 'e', ctrlKey: true } },
    { label: 'Ctrl-K', init: { key: 'k', ctrlKey: true } },
];
const WINDOWS_LINUX_UNROUTED: KeyCase[] = [
    { label: 'Cmd-F', init: { key: 'f', metaKey: true } },
    { label: 'Cmd-B', init: { key: 'b', metaKey: true } },
    { label: 'Ctrl-N', init: { key: 'n', ctrlKey: true } },
    { label: 'Ctrl-S', init: { key: 's', ctrlKey: true } },
    { label: 'Ctrl-P', init: { key: 'p', ctrlKey: true } },
    { label: 'Ctrl-V', init: { key: 'v', ctrlKey: true } },
];

/** Chords that must reach the browser's clipboard default while hidden from the root editor. */
const CLIPBOARD_PASSTHROUGH: Record<SimulatedPlatform, KeyCase[]> = {
    macOS: [
        { label: 'Cmd-C', init: { key: 'c', metaKey: true } },
        { label: 'Cmd-X', init: { key: 'x', metaKey: true } },
        { label: 'Cmd-V', init: { key: 'v', metaKey: true } },
        // Cyrillic layout: the C key reports its typed character, so only keyCode names it.
        { label: 'Cmd-С (Cyrillic)', init: { key: 'с', keyCode: 67, metaKey: true } },
    ],
    Windows: [
        { label: 'Ctrl-C', init: { key: 'c', ctrlKey: true } },
        { label: 'Ctrl-X', init: { key: 'x', ctrlKey: true } },
        { label: 'Ctrl-V', init: { key: 'v', ctrlKey: true } },
        { label: 'Ctrl-С (Cyrillic)', init: { key: 'с', keyCode: 67, ctrlKey: true } },
    ],
    Linux: [
        { label: 'Ctrl-C', init: { key: 'c', ctrlKey: true } },
        { label: 'Ctrl-X', init: { key: 'x', ctrlKey: true } },
        { label: 'Ctrl-V', init: { key: 'v', ctrlKey: true } },
        { label: 'Ctrl-С (Cyrillic)', init: { key: 'с', keyCode: 67, ctrlKey: true } },
    ],
};

/** Clipboard letters under the other platform's modifier, which this platform does not treat as copy/paste. */
const CLIPBOARD_REJECTED: Record<SimulatedPlatform, KeyCase[]> = {
    macOS: [
        { label: 'Ctrl-C', init: { key: 'c', ctrlKey: true } },
        { label: 'Ctrl-X', init: { key: 'x', ctrlKey: true } },
        { label: 'Ctrl-V', init: { key: 'v', ctrlKey: true } },
    ],
    Windows: [
        { label: 'Cmd-C', init: { key: 'c', metaKey: true } },
        { label: 'Cmd-X', init: { key: 'x', metaKey: true } },
        { label: 'Cmd-V', init: { key: 'v', metaKey: true } },
    ],
    Linux: [
        { label: 'Cmd-C', init: { key: 'c', metaKey: true } },
        { label: 'Cmd-X', init: { key: 'x', metaKey: true } },
        { label: 'Cmd-V', init: { key: 'v', metaKey: true } },
    ],
};

const SEARCH_SUPPORTED: Record<SimulatedPlatform, KeyCase[]> = {
    macOS: [{ label: 'Cmd-F', init: { key: 'f', metaKey: true } }],
    Windows: WINDOWS_LINUX_SEARCH,
    Linux: WINDOWS_LINUX_SEARCH,
};

const FUNCTION_KEY_FIND_MATCH: KeyCase[] = [
    { label: 'F3', init: { key: 'F3' } },
    { label: 'Shift-F3', init: { key: 'F3', shiftKey: true } },
];
const WINDOWS_LINUX_FIND_MATCH: KeyCase[] = [
    ...FUNCTION_KEY_FIND_MATCH,
    { label: 'Ctrl-G', init: { key: 'g', ctrlKey: true } },
    { label: 'Ctrl-Shift-G', init: { key: 'g', ctrlKey: true, shiftKey: true } },
];

/** Find next/previous chords, which search from the root selection without opening the panel. */
const FIND_MATCH_SUPPORTED: Record<SimulatedPlatform, KeyCase[]> = {
    macOS: [
        ...FUNCTION_KEY_FIND_MATCH,
        { label: 'Cmd-G', init: { key: 'g', metaKey: true } },
        { label: 'Cmd-Shift-G', init: { key: 'g', metaKey: true, shiftKey: true } },
    ],
    Windows: WINDOWS_LINUX_FIND_MATCH,
    Linux: WINDOWS_LINUX_FIND_MATCH,
};

const FORMATTING_SUPPORTED: Record<SimulatedPlatform, KeyCase[]> = {
    macOS: [
        { label: 'Cmd-B', init: { key: 'b', metaKey: true } },
        { label: 'Cmd-I', init: { key: 'i', metaKey: true } },
        { label: 'Cmd-U', init: { key: 'u', metaKey: true } },
        { label: 'Cmd-`', init: { key: '`', metaKey: true } },
        { label: 'Cmd-E', init: { key: 'e', metaKey: true } },
        { label: 'Cmd-K', init: { key: 'k', metaKey: true } },
    ],
    Windows: WINDOWS_LINUX_FORMATTING,
    Linux: WINDOWS_LINUX_FORMATTING,
};

/** Chords the nested editor leaves to the host: they bubble, but the root editor must ignore them. */
const UNROUTED: Record<SimulatedPlatform, KeyCase[]> = {
    macOS: [
        { label: 'Ctrl-F', init: { key: 'f', ctrlKey: true } },
        { label: 'Ctrl-B', init: { key: 'b', ctrlKey: true } },
        { label: 'Cmd-N', init: { key: 'n', metaKey: true } },
        { label: 'Cmd-S', init: { key: 's', metaKey: true } },
        { label: 'Cmd-P', init: { key: 'p', metaKey: true } },
        { label: 'Cmd-V', init: { key: 'v', metaKey: true } },
    ],
    Windows: WINDOWS_LINUX_UNROUTED,
    Linux: WINDOWS_LINUX_UNROUTED,
};

const UNROUTED_EVERYWHERE: KeyCase[] = [
    { label: 'Alt-Ctrl-B', init: { key: 'b', ctrlKey: true, altKey: true } },
    { label: 'Ctrl-Shift-S', init: { key: 's', ctrlKey: true, shiftKey: true } },
    { label: 'Ctrl+Meta-F', init: { key: 'f', ctrlKey: true, metaKey: true } },
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
const EMPTY_BODY_DOC = ['| H1 | H2 |', '| --- | --- |', '|  |  |'].join('\n');
const FIRST_EDIT = '\n#one';
const SECOND_EDIT = '\n#two';
const LETTER_KEY = /^[a-z]$/i;
installRangeLayoutStubs();

function pressKey(target: EventTarget, init: KeyboardEventInit & { key: string }): KeyboardEvent {
    const isLetter = LETTER_KEY.test(init.key);
    const key = isLetter && init.shiftKey ? init.key.toUpperCase() : init.key;
    const event = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ...init,
        key,
    });
    // jsdom ignores `keyCode` in the init dictionary, and CodeMirror needs it to resolve
    // non-Latin layouts, so an explicit value wins over the one derived from a Latin letter.
    const keyCode = init.keyCode ?? (isLetter ? init.key.toUpperCase().charCodeAt(0) : undefined);
    if (keyCode !== undefined) {
        Object.defineProperty(event, 'keyCode', { get: () => keyCode });
    }
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

export function registerPlatformShortcutTests(
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
                    createNestedEditorDomHandlers(mainView, {
                        syncSelectionToMain: vi.fn(),
                        ensureRootSelectionForCommand: vi.fn(),
                    }),
                    createNestedEditorKeymap(mainView, {
                        closeEditor: vi.fn(),
                        syncPendingChangesToRoot: vi.fn(),
                    }),
                ],
            })
        );
        view.contentDOM.focus();
        return view;
    }

    function mountMainActiveCellView(): EditorView {
        const parent = document.createElement('div');
        document.body.appendChild(parent);
        const view = trackView(
            new EditorView({
                parent,
                doc: TABLE_DOC,
                extensions: [activeCellField],
            })
        );
        view.dispatch({
            effects: setActiveCellEffect.of({
                tableFrom: 0,
                section: 'body',
                row: 0,
                col: 0,
            }),
        });
        return view;
    }

    function mountNestedRoutingView(mainView: EditorView): {
        view: EditorView;
        parentKeyDown: ReturnType<typeof vi.fn>;
        ensureRootSelectionForCommand: ReturnType<typeof vi.fn>;
    } {
        // Mounted in a cell-editor host, as in a rendered table.
        const parent = document.createElement('div');
        parent.className = CLASS_CELL_EDITOR;
        document.body.appendChild(parent);
        const parentKeyDown = vi.fn();
        parent.addEventListener('keydown', parentKeyDown);
        const ensureRootSelectionForCommand = vi.fn();
        const view = trackView(
            new EditorView({
                parent,
                doc: 'cell',
                extensions: createNestedEditorDomHandlers(mainView, {
                    syncSelectionToMain: vi.fn(),
                    ensureRootSelectionForCommand,
                }),
            })
        );
        view.contentDOM.focus();
        return { view, parentKeyDown, ensureRootSelectionForCommand };
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

    function expectSelectionDeleted(init: KeyboardEventInit & { key: string }): void {
        const { view } = mountSelectionView();
        selectBodyCells(view);

        const event = pressKey(document.body, init);

        expect(event.defaultPrevented).toBe(true);
        expect(view.state.doc.toString()).toBe(EMPTY_BODY_DOC);
    }

    function expectSelectionDeleteIgnored(init: KeyboardEventInit & { key: string }): void {
        const { view } = mountSelectionView();
        selectBodyCells(view);

        const event = pressKey(document.body, init);

        expect(event.defaultPrevented).toBe(false);
        expect(view.state.doc.toString()).toBe(TABLE_DOC);
        expect(getCellSelection(view.state)).not.toBeNull();
    }

    it.each(DELETION_SUPPORTED[platform])('cell selection $label deletes the rectangle', ({ init }) => {
        expectSelectionDeleted(init);
    });

    it.each(DELETION_REJECTED[platform])('cell selection $label does not delete the rectangle', ({ init }) => {
        expectSelectionDeleteIgnored(init);
    });

    /**
     * A selection whose table the index cannot resolve, which is what a document rewrite
     * leaves behind while the index is briefly incomplete. Removal declines, but the chord
     * still belongs to the table runtime: the main caret is parked inside the focus cell,
     * so letting it through would delete document text the user cannot see.
     */
    function expectSelectionDeleteSwallowed(init: KeyboardEventInit & { key: string }): void {
        const { view } = mountSelectionView();
        view.dispatch({
            effects: setCellSelectionEffect.of({
                tableFrom: view.state.doc.length,
                anchor: { section: 'body', row: 0, col: 0 },
                focus: { section: 'body', row: 0, col: 1 },
            }),
        });

        const event = pressKey(document.body, init);

        expect(event.defaultPrevented).toBe(true);
        expect(view.state.doc.toString()).toBe(TABLE_DOC);
    }

    it.each(DELETION_SUPPORTED[platform])(
        'cell selection $label is swallowed rather than deleting text when the table does not resolve',
        ({ init }) => {
            expectSelectionDeleteSwallowed(init);
        }
    );

    /** Presses `init` on the root editor and reports whether the root's own keydown listener saw it. */
    function pressClipboardChord(init: KeyboardEventInit & { key: string }): {
        view: EditorView;
        event: KeyboardEvent;
        rootKeyDown: ReturnType<typeof vi.fn>;
    } {
        const { view } = mountSelectionView();
        selectBodyCells(view);
        view.focus();
        const rootKeyDown = vi.fn();
        view.contentDOM.addEventListener('keydown', rootKeyDown);

        return { view, event: pressKey(view.contentDOM, init), rootKeyDown };
    }

    it.each(CLIPBOARD_PASSTHROUGH[platform])(
        'cell selection hides $label from the root editor without suppressing its clipboard event',
        ({ init }) => {
            const { view, event, rootKeyDown } = pressClipboardChord(init);

            expect(rootKeyDown).not.toHaveBeenCalled();
            expect(event.defaultPrevented).toBe(false);
            expect(view.state.doc.toString()).toBe(TABLE_DOC);
            expect(getCellSelection(view.state)).not.toBeNull();
        }
    );

    it.each(CLIPBOARD_REJECTED[platform])('cell selection leaves $label to the root editor', ({ init }) => {
        const { event, rootKeyDown } = pressClipboardChord(init);

        expect(rootKeyDown).toHaveBeenCalledTimes(1);
        expect(event.defaultPrevented).toBe(false);
    });

    function expectRoutedBubble(nested: ReturnType<typeof mountNestedRoutingView>, event: KeyboardEvent): void {
        expect(nested.ensureRootSelectionForCommand).toHaveBeenCalledTimes(1);
        expect(nested.parentKeyDown).toHaveBeenCalledTimes(1);
        expect(event.defaultPrevented).toBe(false);
        expect(isNestedEditorOwnedEvent(event)).toBe(false);
    }

    function expectUnroutedBubble(nested: ReturnType<typeof mountNestedRoutingView>, event: KeyboardEvent): void {
        expect(nested.parentKeyDown).toHaveBeenCalledTimes(1);
        expect(nested.ensureRootSelectionForCommand).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
        expect(isNestedEditorOwnedEvent(event)).toBe(true);
    }

    // Routed chords leave the nested editor mounted: closing it would detach the event target
    // before the root editor sees the keydown. Search closes it through the panel's open transition.
    it.each([...SEARCH_SUPPORTED[platform], ...FIND_MATCH_SUPPORTED[platform], ...FORMATTING_SUPPORTED[platform]])(
        'nested $label synchronizes the root selection and bubbles to the root editor',
        ({ init }) => {
            const mainView = mountMainActiveCellView();
            const nested = mountNestedRoutingView(mainView);

            const event = pressKey(nested.view.contentDOM, init);

            expectRoutedBubble(nested, event);
            expect(getActiveCell(mainView.state)).not.toBeNull();
        }
    );

    it.each(UNROUTED[platform])('nested $label bubbles to the host but not the root editor', ({ init }) => {
        const mainView = mountMainActiveCellView();
        const nested = mountNestedRoutingView(mainView);

        expectUnroutedBubble(nested, pressKey(nested.view.contentDOM, init));
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

    it.each(DELETION_REJECTED_EVERYWHERE)('cell selection $label does not delete the rectangle', ({ init }) => {
        expectSelectionDeleteIgnored(init);
    });

    it('leaves Shift+Delete to native cut instead of rectangle deletion', () => {
        expectSelectionDeleteIgnored({ key: 'Delete', shiftKey: true });
    });

    it.each(UNROUTED_EVERYWHERE)('nested $label bubbles to the host but not the root editor', ({ init }) => {
        const mainView = mountMainActiveCellView();
        const nested = mountNestedRoutingView(mainView);

        expectUnroutedBubble(nested, pressKey(nested.view.contentDOM, init));
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
        view.dispatch({ effects: startCellDragEffect.of(null) });

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

        function mountLifecycleView(doc: string, selectionAnchor: number, ...extra: Extension[]): EditorView {
            const parent = document.createElement('div');
            document.body.appendChild(parent);
            return trackView(
                new EditorView({
                    parent,
                    state: EditorState.create({
                        doc,
                        selection: EditorSelection.single(selectionAnchor),
                        extensions: nestedEditorTestExtensions(history(), ...extra),
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

        it('lets the root keymap see only chords routed to it, while the host sees every chord', async () => {
            const formatting = FORMATTING_SUPPORTED[platform][0];
            const unrouted = UNROUTED[platform][0];
            const rootFormatting = vi.fn(() => true);
            const rootUnrouted = vi.fn(() => true);
            const toBinding = ({ init }: KeyCase) =>
                [init.metaKey && 'Meta', init.ctrlKey && 'Ctrl', init.key].filter(Boolean).join('-');
            const doc = ['| H1 |', '| --- |', '| abc |'].join('\n');
            const view = mountLifecycleView(
                doc,
                doc.indexOf('abc'),
                keymap.of([
                    { key: toBinding(formatting), run: rootFormatting },
                    { key: toBinding(unrouted), run: rootUnrouted },
                ])
            );
            await openBodyCell(view, 0);
            const hostKeyDown = vi.fn();
            document.addEventListener('keydown', hostKeyDown);

            try {
                pressKey(document.activeElement ?? view.contentDOM, unrouted.init);
                expect(rootUnrouted).not.toHaveBeenCalled();
                expect(hostKeyDown).toHaveBeenCalledTimes(1);

                pressKey(document.activeElement ?? view.contentDOM, formatting.init);
                expect(rootFormatting).toHaveBeenCalledTimes(1);
                expect(hostKeyDown).toHaveBeenCalledTimes(2);
            } finally {
                document.removeEventListener('keydown', hostKeyDown);
            }
        });

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
