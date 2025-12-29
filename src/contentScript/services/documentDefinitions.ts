/**
 * Tracks document-level link reference and footnote definitions.
 * Provides a pre-built definition block for injection into cell render payloads,
 * enabling reference-style links and footnotes to work inside table cells.
 */

import { StateField, EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';

/** Parsed document definitions */
export interface DocumentDefinitions {
    /** Reference link definitions: lowercase label → url */
    referenceLinks: Map<string, string>;
    /** Footnote definition labels (lowercase) */
    footnotes: Set<string>;
    /** Pre-built markdown block ready for injection */
    definitionBlock: string;
}

/**
 * StateField that tracks all link reference and footnote definitions.
 * Rebuilds on document changes.
 */
export const documentDefinitionsField = StateField.define<DocumentDefinitions>({
    create(state) {
        return extractDefinitions(state);
    },
    update(current, tr) {
        if (!tr.docChanged) return current;
        return extractDefinitions(tr.state);
    },
});

/**
 * Extract all definitions from the document.
 */
function extractDefinitions(state: EditorState): DocumentDefinitions {
    const referenceLinks = new Map<string, string>();
    const footnotes = new Set<string>();

    // Use syntax tree for reference link definitions
    // Timeout of 200ms is acceptable for background extraction
    const tree = ensureSyntaxTree(state, state.doc.length, 200);
    if (tree) {
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
    }

    // Extract footnote definitions via regex (CM6 doesn't parse these natively)
    extractFootnoteDefinitions(state, footnotes);

    // Build the injectable definition block
    const definitionBlock = buildDefinitionBlock(referenceLinks, footnotes);

    return { referenceLinks, footnotes, definitionBlock };
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
 * Extract footnote definition labels from the document.
 * Pattern: [^label]: at start of line (not inside code blocks)
 */
function extractFootnoteDefinitions(state: EditorState, footnotes: Set<string>): void {
    const pattern = /^\s*\[\^([^\]]+)\]:/;
    let inFencedCode = false;

    for (let i = 1; i <= state.doc.lines; i++) {
        const line = state.doc.line(i).text;

        // Track fenced code blocks
        if (/^(`{3,}|~{3,})/.test(line)) {
            inFencedCode = !inFencedCode;
            continue;
        }

        if (!inFencedCode) {
            const match = pattern.exec(line);
            if (match) {
                footnotes.add(match[1].toLowerCase());
            }
        }
    }
}

/**
 * Build a markdown definition block from extracted definitions.
 * This block is appended to cell content before rendering.
 */
function buildDefinitionBlock(refs: Map<string, string>, footnotes: Set<string>): string {
    if (refs.size === 0 && footnotes.size === 0) {
        return '';
    }

    const lines: string[] = [];

    for (const [label, url] of refs) {
        lines.push(`[${label}]: ${url}`);
    }

    for (const label of footnotes) {
        // Inject minimal placeholder content for the footnote definition
        // The actual footnote content isn't needed for link resolution
        lines.push(`[^${label}]: .`);
    }

    return lines.join('\n');
}
