import type { EditorView } from '@codemirror/view';
import { CLASS_CELL_EDITOR } from '../../shared/tableDomClasses';
import { getActiveCell } from '../../tableState/activeCellState';
import { getCellSelection, type CellSelection } from '../../tableState/cellSelectionState';
import { makeTableId } from '../../tableModel/types';
import { CLASS_FLOATING_TOOLBAR, findTableWidgetElement } from '../../tableWidget/domHelpers';

/** Native HTML elements that handle their own keyboard/clipboard events. */
const NATIVE_INTERACTIVE_ELEMENTS = [
    'input',
    'textarea',
    'select',
    'button',
    'summary',
    'option',
    'a[href]',
    '[contenteditable=""]',
    '[contenteditable="true"]',
];

/** ARIA widget roles that indicate interactive components. */
const ARIA_INTERACTIVE_ROLES = [
    '[role="button"]',
    '[role="link"]',
    '[role="menu"]',
    '[role="menuitem"]',
    '[role="dialog"]',
    '[role="textbox"]',
    '[role="listbox"]',
    '[role="option"]',
    '[role="combobox"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="tab"]',
    '[role="toolbar"]',
];

const INTERACTIVE_SELECTOR = [...NATIVE_INTERACTIVE_ELEMENTS, ...ARIA_INTERACTIVE_ROLES].join(', ');

function isInteractiveElement(element: Element): boolean {
    if (element.closest(`.${CLASS_FLOATING_TOOLBAR}`)) {
        return true;
    }

    if (element.closest(INTERACTIVE_SELECTOR)) {
        return true;
    }

    // Catch elements that inherit contenteditable from a parent (not matched by the attribute selectors above).
    return element instanceof HTMLElement && element.isContentEditable;
}

function isNestedEditorElement(element: Element): boolean {
    return Boolean(element.closest(`.${CLASS_CELL_EDITOR}`));
}

/**
 * Structural/container elements that can hold focus without being interactive:
 * body and documentElement receive focus after a blur (or in Electron when no
 * element is focused); the CM containers receive focus during programmatic
 * focus shifts.
 */
function isStructuralFocusHost(view: EditorView, element: Element): boolean {
    const doc = view.dom.ownerDocument;
    const structuralHosts: Array<Element | null> = [
        doc.body,
        doc.documentElement,
        view.dom,
        view.contentDOM,
        view.scrollDOM,
    ];

    return structuralHosts.includes(element);
}

/** True when `element` is the widget rendering `selection`'s table, or lives inside it. */
function isInsideSelectedTableWidget(view: EditorView, selection: CellSelection, element: Element): boolean {
    const selectedWidget = findTableWidgetElement(view, makeTableId(selection.tableFrom));

    // `contains()` is self-inclusive, so this also covers the widget root itself.
    return Boolean(selectedWidget?.contains(element));
}

/**
 * Classifies whether the table runtime owns an event based on the focused element.
 *
 * Branch order is significant:
 * 1. Nested cell editors belong to this table runtime, even though their editable
 *    content would otherwise be classified as an interactive element — so they are
 *    checked before the interactive gate.
 * 2. Genuinely interactive elements (toolbar buttons, dialogs, inputs) handle their
 *    own events, so yield to them.
 * 3. Everything below requires a selection the user can act on:
 *    - a structural focus host means focus is parked on a container rather than a
 *      real control;
 *    - a non-interactive element inside the selected widget keeps table shortcuts
 *      working while the widget has soft focus;
 *    - anywhere else inside this CM instance is handled to prevent the event from
 *      reaching unrelated handlers outside the table context.
 */
function canHandleShortcutForFocusedElement(
    view: EditorView,
    selection: CellSelection | null,
    activeElement: Element
): boolean {
    if (isNestedEditorElement(activeElement) && view.dom.contains(activeElement)) {
        return true;
    }

    if (selection && isStructuralFocusHost(view, activeElement)) {
        return true;
    }

    if (isInteractiveElement(activeElement)) {
        return false;
    }

    if (!selection) {
        return false;
    }

    return isInsideSelectedTableWidget(view, selection, activeElement) || view.dom.contains(activeElement);
}

/**
 * Determines whether document-level capture-phase event listeners should handle
 * a clipboard event (copy/cut/paste) or a keyboard shortcut that applies to both
 * cell selections and active cells. Returns true when focus is in a location where
 * the table plugin should own the event.
 */
export function canHandleTableClipboardShortcut(view: EditorView): boolean {
    const selection = getCellSelection(view.state);

    // No table interaction state at all — nothing to handle.
    if (!selection && !getActiveCell(view.state)) {
        return false;
    }

    const doc = view.dom.ownerDocument;
    const activeElement = doc.activeElement;
    // No focused element (e.g., focus is in a detached iframe or was never set).
    // Only handle if we have a visible selection that needs protecting.
    if (!activeElement) {
        return Boolean(selection);
    }

    return canHandleShortcutForFocusedElement(view, selection, activeElement);
}

/**
 * Determines whether document-level capture-phase keydown listeners should handle
 * a cell-selection keyboard shortcut (arrow navigation, delete, escape, enter/tab).
 * Stricter than `canHandleTableClipboardShortcut`: requires an active cell selection.
 */
export function canHandleTableSelectionKeydown(view: EditorView): boolean {
    return Boolean(getCellSelection(view.state)) && canHandleTableClipboardShortcut(view);
}
