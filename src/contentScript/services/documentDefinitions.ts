/**
 * Tracks document-level link reference definitions.
 * Provides a pre-built definition block for injection into cell render payloads,
 * enabling reference-style links to work inside table cells.
 *
 * NOTE: Footnotes are not handled here (they are handled by post processing the HTML).
 * This is because markdown-it-footnote auto-numbers footnotes based on order of appearance in each render context.
 * Since each cell is rendered independently, both [^1] and [^2] become footnote #1 in their respective cells.
 */

import { StateField, EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';

/** Parsed document definitions */
export interface DocumentDefinitions {
    /** Reference link definitions: lowercase label → url */
    referenceLinks: Map<string, string>;
    /** Pre-built markdown block ready for injection */
    definitionBlock: string;
}

/**
 * StateField that tracks all link reference definitions.
 * Rebuilds on document changes.
 */
export const documentDefinitionsField = StateField.define<DocumentDefinitions>({
    create(state) {
        return extractDefinitions(state) || { referenceLinks: new Map(), definitionBlock: '' };
    },
    update(current, tr) {
        if (!tr.docChanged) return current;
        const newDefs = extractDefinitions(tr.state);
        return newDefs || current;
    },
});

/**
 * Extract all definitions from the document.
 * Returns null if syntax tree cannot be obtained within timeout.
 */
function extractDefinitions(state: EditorState): DocumentDefinitions | null {
    const referenceLinks = new Map<string, string>();

    // Use syntax tree for reference link definitions
    // Timeout of 200ms is acceptable for background extraction
    const tree = ensureSyntaxTree(state, state.doc.length, 200);
    if (!tree) {
        return null;
    }

    const cursor = tree.cursor();
    do {
        if (cursor.name === 'LinkReference') {
            const result = extractLinkReference(cursor.node, state);
            if (result) {
                // First definition wins (per CommonMark spec)
                const key = result.label.toLowerCase();
                if (!referenceLinks.has(key)) {
                    referenceLinks.set(key, result.url);
                }
            }
        }
    } while (cursor.next());

    // Build the injectable definition block (link references only)
    const definitionBlock = buildDefinitionBlock(referenceLinks);

    return { referenceLinks, definitionBlock };
}

/**
 * Extract label and URL from a LinkReference syntax node.
 * LinkReference structure: [label]: URL "optional title"
 */
function extractLinkReference(node: SyntaxNode, state: EditorState): { label: string; url: string } | null {
    const cursor = node.cursor();
    if (!cursor.firstChild()) return null;

    let label: string | null = null;
    let url: string | null = null;

    do {
        if (cursor.name === 'LinkLabel') {
            // LinkLabel includes brackets, e.g. "[foo]"
            const text = state.doc.sliceString(cursor.from, cursor.to);
            // Strip brackets
            label = text.slice(1, -1);
        } else if (cursor.name === 'URL') {
            url = state.doc.sliceString(cursor.from, cursor.to);
        }
    } while (cursor.nextSibling());

    if (label && url) {
        return { label, url };
    }
    return null;
}

/**
 * Build a markdown definition block from extracted definitions.
 * This block is appended to cell content before rendering.
 */
function buildDefinitionBlock(refs: Map<string, string>): string {
    if (refs.size === 0) {
        return '';
    }

    const lines: string[] = [];

    for (const [label, url] of refs) {
        lines.push(`[${label}]: ${url}`);
    }

    return lines.join('\n');
}
