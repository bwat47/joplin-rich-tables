import { CLASS_CELL_CONTENT, CLASS_CELL_EDITOR } from '../tableWidget/domHelpers';

/** Ensures the cell element has the required structure (content div and editor host div). */
export function ensureCellWrapper(cell: HTMLElement): { content: HTMLElement; editorHost: HTMLElement } {
    let content = cell.querySelector(`:scope > .${CLASS_CELL_CONTENT}`) as HTMLElement | null;
    if (!content) {
        content = document.createElement('div');
        content.className = CLASS_CELL_CONTENT;

        while (cell.firstChild) {
            content.appendChild(cell.firstChild);
        }
        cell.appendChild(content);
    }

    let editorHost = cell.querySelector(`:scope > .${CLASS_CELL_EDITOR}`) as HTMLElement | null;
    if (!editorHost) {
        editorHost = document.createElement('div');
        editorHost.className = CLASS_CELL_EDITOR;
        editorHost.style.display = 'none';
        cell.appendChild(editorHost);
    }

    return { content, editorHost };
}
