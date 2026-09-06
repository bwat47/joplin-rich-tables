import { vi, type Mock } from 'vitest';
import { EditorState, type Extension, type TransactionSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { getCellSelector, SECTION_BODY, SECTION_HEADER, SELECTOR_CELL } from '../tableWidget/domHelpers';
import { CLASS_CELL_CONTENT } from '../shared/tableDomClasses';
import { activeCellField, setActiveCellEffect, type ActiveCell } from '../tableState/activeCellState';
import { cellSelectionField } from '../tableState/cellSelectionState';
import { sourceModeField } from '../tableState/sourceMode';
import { openCellRequestField } from '../tableRuntime/openCellRequest';
import { createMarkdownState } from './testMarkdownState';

export const NON_CANONICAL_DOC = ['|H1|H2|', '|---|---|', '|a|b|'].join('\n');

interface CellStub {
    dataset: Record<string, string>;
    closest: (selector: string) => unknown;
    querySelector: (selector: string) => unknown;
    ownerDocument?: Document;
}

/** The cells this harness builds, named as its `cells` result spells them. */
export type HarnessCellName = 'header0' | 'header1' | 'body0' | 'body1';

/** Rendered content for one cell, as a test declares it. */
export interface RenderedCellContent {
    /** Inner HTML of the cell's rendered content wrapper. */
    html: string;
    /**
     * The caret the document's hit test reports for any press in this cell: `offset` within
     * the text node whose data is `text`. Omitting it makes the hit test find no caret, which
     * is what a press that missed the content box produces.
     */
    caretAt?: { text: string; offset: number };
}

/** Locates a text node by its content, so a declaration can name a caret without walking the tree. */
function findTextNode(root: HTMLElement, data: string): Text {
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
        if ((node as Text).data === data) {
            return node as Text;
        }
        node = walker.nextNode();
    }
    throw new Error(`No text node with data ${JSON.stringify(data)}`);
}

/**
 * Builds a cell's rendered content wrapper and the document its caret hit test answers from.
 *
 * Requires a DOM, so it runs only for cells a test declared content for; the rest of the
 * harness stays usable under the default node environment.
 */
function buildRenderedContent(declared: RenderedCellContent): { content: HTMLElement; ownerDocument: Document } {
    const content = document.createElement('div');
    content.className = CLASS_CELL_CONTENT;
    content.innerHTML = declared.html;

    const caretAt = declared.caretAt;
    const caretRangeFromPoint = (): Range | null => {
        if (!caretAt) {
            return null;
        }
        const range = document.createRange();
        range.setStart(findTextNode(content, caretAt.text), caretAt.offset);
        range.collapse(true);
        return range;
    };

    return { content, ownerDocument: { caretRangeFromPoint } as unknown as Document };
}

export interface MutableTestView {
    state: EditorState;
    dispatch: Mock<(spec: TransactionSpec) => void>;
    focus: Mock;
    posAtDOM: Mock;
    requestMeasure: Mock;
    contentDOM: {
        querySelectorAll: Mock;
    };
    dom: {
        isConnected: boolean;
    };
}

export function getLastDispatchSpec(view: MutableTestView): TransactionSpec {
    const call = view.dispatch.mock.calls[view.dispatch.mock.calls.length - 1];
    if (!call) {
        throw new Error('Expected a dispatch call');
    }
    return call[0];
}

export function createInteractiveTableHarness(params?: {
    doc?: string;
    activeCell?: ActiveCell;
    extensions?: Extension[];
    /**
     * Rendered content for the named cells, which a press can then resolve a caret against.
     * Cells left out carry no content wrapper, so a press on one yields no caret to place
     * from and entry falls back to mirroring the main selection.
     *
     * Declaring any needs a DOM environment.
     */
    renderedContent?: Partial<Record<HarnessCellName, RenderedCellContent>>;
}): {
    view: EditorView;
    cells: Record<HarnessCellName, HTMLElement>;
} {
    let currentState = createMarkdownState(params?.doc ?? NON_CANONICAL_DOC, [
        activeCellField,
        cellSelectionField,
        sourceModeField,
        openCellRequestField,
        ...(params?.extensions ?? []),
    ]);
    if (params?.activeCell) {
        currentState = currentState.update({ effects: setActiveCellEffect.of(params.activeCell) }).state;
    }

    const widget = {
        querySelector: vi.fn((selector: string) => cellMap.get(selector) ?? null),
    };

    const createCellStub = (
        name: HarnessCellName,
        section: 'header' | 'body',
        row: number,
        col: number
    ): HTMLElement => {
        const declared = params?.renderedContent?.[name];
        const rendered = declared ? buildRenderedContent(declared) : null;

        const cell: CellStub = {
            dataset: {
                section,
                row: String(row),
                col: String(col),
            },
            closest: (selector: string) => {
                if (selector === SELECTOR_CELL) {
                    return cell;
                }
                if (selector === 'a') {
                    return null;
                }
                if (selector.includes('cm-table-widget')) {
                    return widget;
                }
                return null;
            },
            querySelector: (selector: string) =>
                selector.includes(CLASS_CELL_CONTENT) ? (rendered?.content ?? null) : null,
            ownerDocument: rendered?.ownerDocument,
        };

        return cell as unknown as HTMLElement;
    };

    const cells: Record<HarnessCellName, HTMLElement> = {
        header0: createCellStub('header0', SECTION_HEADER, 0, 0),
        header1: createCellStub('header1', SECTION_HEADER, 0, 1),
        body0: createCellStub('body0', SECTION_BODY, 0, 0),
        body1: createCellStub('body1', SECTION_BODY, 0, 1),
    };

    const cellMap = new Map<string, HTMLElement>([
        [getCellSelector({ section: 'header', row: 0, col: 0 }), cells.header0],
        [getCellSelector({ section: 'header', row: 0, col: 1 }), cells.header1],
        [getCellSelector({ section: 'body', row: 0, col: 0 }), cells.body0],
        [getCellSelector({ section: 'body', row: 0, col: 1 }), cells.body1],
    ]);

    const view: MutableTestView = {
        state: currentState,
        dispatch: vi.fn((spec: TransactionSpec) => {
            currentState = currentState.update(spec).state;
            view.state = currentState;
        }),
        focus: vi.fn(),
        posAtDOM: vi.fn(() => 0),
        requestMeasure: vi.fn(),
        contentDOM: {
            querySelectorAll: vi.fn(() => [widget]),
        },
        dom: {
            isConnected: true,
        },
    };

    return { view: view as unknown as EditorView, cells };
}
