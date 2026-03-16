import type { EditorView } from '@codemirror/view';
import { CLASS_CELL_EDITOR } from '../shared/tableDomClasses';
import { getActiveCell } from '../tableState/activeCellState';
import { getCellSelection } from '../tableState/cellSelectionState';
import { makeTableId } from '../tableModel/types';
import { CLASS_FLOATING_TOOLBAR, findTableWidgetElement } from '../tableWidget/domHelpers';

const INTERACTIVE_SELECTOR = [
    'input',
    'textarea',
    'select',
    'button',
    'summary',
    'option',
    'a[href]',
    '[contenteditable=""]',
    '[contenteditable="true"]',
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
].join(', ');

function isInteractiveElement(element: Element): boolean {
    if (element.closest(`.${CLASS_FLOATING_TOOLBAR}`)) {
        return true;
    }

    if (element.closest(INTERACTIVE_SELECTOR)) {
        return true;
    }

    return element instanceof HTMLElement && element.isContentEditable;
}

function isNestedEditorElement(element: Element): boolean {
    return Boolean(element.closest(`.${CLASS_CELL_EDITOR}`));
}

export function canHandleTableClipboardShortcut(view: EditorView): boolean {
    const selection = getCellSelection(view.state);
    const activeCell = getActiveCell(view.state);
    if (!selection && !activeCell) {
        return false;
    }

    const doc = view.dom.ownerDocument;
    const activeElement = doc.activeElement;
    if (!activeElement) {
        return Boolean(selection);
    }

    if (isNestedEditorElement(activeElement) && view.dom.contains(activeElement)) {
        return true;
    }

    if (isInteractiveElement(activeElement)) {
        return false;
    }

    if (
        activeElement === doc.body ||
        activeElement === doc.documentElement ||
        activeElement === view.dom ||
        activeElement === view.contentDOM ||
        activeElement === view.scrollDOM
    ) {
        return Boolean(selection);
    }

    if (selection) {
        const selectedWidget = findTableWidgetElement(view, makeTableId(selection.tableFrom));
        if (selectedWidget && (activeElement === selectedWidget || selectedWidget.contains(activeElement))) {
            return true;
        }

        return view.dom.contains(activeElement);
    }

    return false;
}

export function canHandleTableSelectionShortcut(view: EditorView): boolean {
    return Boolean(getCellSelection(view.state)) && canHandleTableClipboardShortcut(view);
}
