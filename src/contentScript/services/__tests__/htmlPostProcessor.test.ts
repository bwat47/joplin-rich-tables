/** @jest-environment jsdom */

import { postProcessHtml } from '../htmlPostProcessor';

describe('postProcessHtml', () => {
    test('removes Joplin resource icon spans but keeps placeholder resources', () => {
        const html =
            '<div class="cm-table-cell-content">' +
            '<a data-resource-id="e869bb036f2b4d7dbda9cb5cb81a554f" href="#">' +
            '<span class="resource-icon fa-file-pdf"></span>' +
            'Mintus_Piotr_Performance and Memory.pdf' +
            '</a>' +
            '</div>' +
            '<div class="cm-table-cell-content">' +
            '<span class="not-loaded-resource not-loaded-image-resource">' +
            '<img src="data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>" />' +
            '</span>' +
            '</div>';

        const result = postProcessHtml(html);

        expect(result).not.toContain('resource-icon');
        expect(result).toContain('Mintus_Piotr_Performance and Memory.pdf');
        expect(result).toContain('not-loaded-resource');
        expect(result).toContain('<img');
    });
});
