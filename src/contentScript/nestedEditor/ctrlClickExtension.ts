/**
 * Ctrl+click extension for opening links in the nested cell editor.
 * Simplified version inspired by joplin-context-utils.
 */
import { EditorView } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { SyntaxNode } from '@lezer/common';
import { openLink } from '../services/markdownRenderer';

/**
 * Extract URL from a Link or Image syntax node by finding the URL child.
 */
function extractUrl(node: SyntaxNode, view: EditorView): string | null {
    const cursor = node.cursor();

    if (!cursor.firstChild()) return null;

    do {
        if (cursor.name === 'URL') {
            return view.state.doc.sliceString(cursor.from, cursor.to);
        }
    } while (cursor.nextSibling());

    return null;
}

/**
 * Check if URL is a supported type we can open.
 * Returns the URL if valid, null otherwise.
 */
function getSupportedUrl(url: string): string | null {
    // Joplin resource/note links
    if (url.match(/^:\/[a-f0-9]{32}(#[^\s]*)?$/i)) {
        return url;
    }
    // External URLs
    if (url.match(/^https?:\/\//)) {
        return url;
    }
    // Email links
    if (url.match(/^mailto:/i)) {
        return url;
    }
    return null;
}

/**
 * Find a link URL at the given position using the syntax tree.
 */
function findLinkAtPosition(view: EditorView, pos: number): string | null {
    const tree = syntaxTree(view.state);
    let foundUrl: string | null = null;

    tree.iterate({
        from: pos,
        to: pos,
        enter: (node) => {
            // Check for markdown link [text](url) or image ![alt](url)
            if (node.type.name === 'Link' || node.type.name === 'Image') {
                const url = extractUrl(node.node, view);
                if (url) {
                    const supported = getSupportedUrl(url);
                    if (supported) {
                        foundUrl = supported;
                        return false; // Stop iteration
                    }
                }
            }
            // Check for autolinks <url>
            else if (node.type.name === 'Autolink' || node.type.name === 'URL') {
                let urlText = view.state.doc.sliceString(node.from, node.to);
                // Remove angle brackets if present
                urlText = urlText.replace(/^<|>$/g, '');
                const supported = getSupportedUrl(urlText);
                if (supported) {
                    foundUrl = supported;
                    return false;
                }
            }
        },
    });

    return foundUrl;
}

/**
 * Detect if user is on Mac for proper modifier key handling.
 */
function preferMacShortcuts(): boolean {
    return typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

/**
 * Extension that handles ctrl+click (cmd+click on Mac) to open links.
 * Uses high precedence to intercept before default CodeMirror behavior.
 */
export function ctrlClickLinkExtension() {
    return Prec.high(
        EditorView.domEventHandlers({
            mousedown: (event: MouseEvent, view: EditorView) => {
                const hasModifier = preferMacShortcuts() ? event.metaKey : event.ctrlKey;

                if (!hasModifier) {
                    return false;
                }

                // Don't interfere with multi-cursor (ctrl+click adds cursors)
                if (view.state.selection.ranges.length > 1) {
                    return false;
                }

                const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
                if (pos === null) {
                    return false;
                }

                const url = findLinkAtPosition(view, pos);
                if (url) {
                    event.preventDefault();
                    openLink(url);
                    return true;
                }

                return false;
            },
        })
    );
}
