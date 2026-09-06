/** @vitest-environment jsdom */

import { postProcessHtml } from '../services/htmlPostProcessor';

function parseHtml(html: string): DocumentFragment {
    const template = document.createElement('template');
    template.innerHTML = html;
    return template.content;
}

describe('postProcessHtml', () => {
    test('returns HTML that needs no post-processing without parsing it', () => {
        // Single-quoted attributes survive only if the HTML was never round-tripped through a
        // template element, so this shows both passes were skipped rather than run to no effect.
        const html = "<p class='cell'><strong>bold</strong> and <em>italic</em></p>";

        expect(postProcessHtml(html)).toBe(html);
    });

    test('still parses HTML carrying markers for either pass', () => {
        expect(postProcessHtml('<p class=\'cell\'><span class="joplin-source">raw</span>kept</p>')).toBe(
            '<p class="cell">kept</p>'
        );
        expect(postProcessHtml("<p class='cell'>see [^note]</p>")).toContain('footnote');
    });

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

    test('removes .joplin-source blocks', () => {
        const html =
            '<div class="cm-table-cell-content">' +
            '<span class="joplin-source">raw stuff</span>' +
            '<span class="keep">ok</span>' +
            '</div>';

        const result = postProcessHtml(html);
        const doc = parseHtml(result);

        expect(doc.querySelector('.joplin-source')).toBeNull();
        expect(doc.querySelector('.keep')?.textContent).toBe('ok');
    });

    test('converts footnote refs in text nodes but not inside code/pre', () => {
        const html =
            '<div>' + 'Before [^abc] after' + '<code>code [^nope]</code>' + '<pre>pre [^nope2]</pre>' + '</div>';

        const result = postProcessHtml(html);
        const doc = parseHtml(result);

        const ref = doc.querySelector('sup.footnote-ref a') as HTMLAnchorElement | null;
        expect(ref).not.toBeNull();
        expect(ref?.getAttribute('href')).toBe('#fn-abc');
        expect(ref?.textContent).toBe('abc');

        expect(doc.querySelector('code')?.textContent).toBe('code [^nope]');
        expect(doc.querySelector('pre')?.textContent).toBe('pre [^nope2]');
    });

    test('converts every footnote ref in a text node and keeps the surrounding text', () => {
        const html = '<div>start [^one] middle [^two] end</div>';

        const result = postProcessHtml(html);
        const doc = parseHtml(result);

        const refs = Array.from(doc.querySelectorAll('sup.footnote-ref a'));
        expect(refs.map((ref) => ref.textContent)).toEqual(['one', 'two']);
        expect(doc.querySelector('div')?.textContent).toBe('start one middle two end');
    });

    test('converts adjacent footnote refs without inserting empty text', () => {
        const html = '<div>[^a][^b]</div>';

        const result = postProcessHtml(html);
        const doc = parseHtml(result);

        const div = doc.querySelector('div') as HTMLElement;
        expect(Array.from(div.childNodes).map((n) => n.nodeName)).toEqual(['SUP', 'SUP']);
    });

    test('encodes labels with characters that are not URL safe', () => {
        const html = '<div>see [^note 1]</div>';

        const result = postProcessHtml(html);
        const doc = parseHtml(result);

        const ref = doc.querySelector('sup.footnote-ref a');
        expect(ref?.getAttribute('href')).toBe('#fn-note%201');
        expect(ref?.textContent).toBe('note 1');
    });

    test('leaves text without footnote refs untouched', () => {
        const html = '<div>plain [not a ref] text</div>';

        const result = postProcessHtml(html);

        expect(result).toBe(html);
    });

    test('replaces KaTeX HTML with MathML and removes annotations and direct text nodes', () => {
        const html =
            '<div>' +
            '<span class="katex">' +
            '<span class="katex-mathml">' +
            '<math>' +
            '<annotation>raw-tex</annotation>' +
            'accessibility text' +
            '<mrow><mi>x</mi></mrow>' +
            '</math>' +
            '</span>' +
            '<span class="katex-html">ignored</span>' +
            '</span>' +
            '</div>';

        const result = postProcessHtml(html);
        const doc = parseHtml(result);

        expect(doc.querySelector('.katex')).toBeNull();

        const math = doc.querySelector('math');
        expect(math).not.toBeNull();
        expect(math?.querySelector('annotation')).toBeNull();

        // Ensure no direct text node children remain under <math>
        const directTextNodes = Array.from(math?.childNodes ?? []).filter((n) => n.nodeType === Node.TEXT_NODE);
        expect(directTextNodes).toHaveLength(0);

        expect(math?.querySelector('mrow')).not.toBeNull();
    });
});
