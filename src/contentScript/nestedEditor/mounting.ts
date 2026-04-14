import { CLASS_CELL_CONTENT, CLASS_CELL_EDITOR } from '../shared/tableDomClasses';

/** Ensures the cell element has the required structure (content div and editor host div). */
export function ensureCellWrapper(cell: HTMLElement): { content: HTMLElement; editorHost: HTMLElement } {
    const doc = cell.ownerDocument;
    let content = cell.querySelector(`:scope > .${CLASS_CELL_CONTENT}`) as HTMLElement | null;
    if (!content) {
        content = doc.createElement('div');
        content.className = CLASS_CELL_CONTENT;

        while (cell.firstChild) {
            content.appendChild(cell.firstChild);
        }
        cell.appendChild(content);
    }

    let editorHost = cell.querySelector(`:scope > .${CLASS_CELL_EDITOR}`) as HTMLElement | null;
    if (!editorHost) {
        editorHost = doc.createElement('div');
        editorHost.className = CLASS_CELL_EDITOR;
        // Visibility is controlled via CSS: hidden by default, shown when the parent
        // cell has CLASS_CELL_ACTIVE.
        cell.appendChild(editorHost);
    }

    return { content, editorHost };
}
