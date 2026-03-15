import type { EditorView } from '@codemirror/view';
import { CLASS_FLOATING_TOOLBAR, findTableWidgetElement } from './domHelpers';
import { getCellSelection } from './cellSelectionState';
import { makeTableId } from '../tableModel/types';

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

export function canHandleTableSelectionShortcut(view: EditorView): boolean {
    const selection = getCellSelection(view.state);
    if (!selection) {
        return false;
    }

    const doc = view.dom.ownerDocument;
    const activeElement = doc.activeElement;
    if (!activeElement) {
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
        return true;
    }

    const selectedWidget = findTableWidgetElement(view, makeTableId(selection.tableFrom));
    if (selectedWidget && (activeElement === selectedWidget || selectedWidget.contains(activeElement))) {
        return true;
    }

    return view.dom.contains(activeElement);
}
