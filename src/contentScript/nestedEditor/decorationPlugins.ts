import { Decoration, DecorationSet, EditorView, MatchDecorator, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { ensureSyntaxTree } from '@codemirror/language';
import { Range } from '@codemirror/state';

/**
 * Decorates the entire `InlineCode` syntax node (including backticks) with a unified class.
 * allowing for a continuous border/background around the whole segment.
 */
export const inlineCodePlugin = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
            this.decorations = this.computeDecorations(view);
        }

        update(update: ViewUpdate) {
            if (update.docChanged || update.viewportChanged) {
                this.decorations = this.computeDecorations(update.view);
            }
        }

        computeDecorations(view: EditorView): DecorationSet {
            const widgets: Range<Decoration>[] = [];
            for (const { from, to } of view.visibleRanges) {
                // InlineCode decorator relies on the parser identifying specific nodes.
                // In large documents, the syntax tree might not be fully parsed up to the
                // visible cell (especially since the nested editor uses the FULL document).
                //
                // ensureSyntaxTree(view.state, to, timeout) attempts to parse up to `to`
                // within the timeout.
                const tree = ensureSyntaxTree(view.state, to, 100);
                if (!tree) {
                    continue;
                }

                tree.iterate({
                    from,
                    to,
                    enter: (node) => {
                        if (node.name === 'InlineCode') {
                            widgets.push(
                                Decoration.mark({
                                    class: 'cm-inline-code',
                                }).range(node.from, node.to)
                            );
                        }
                    },
                });
            }
            return Decoration.set(widgets);
        }
    },
    {
        decorations: (v) => v.decorations,
    }
);

/**
 * Decorates `==mark==` syntax with a highlight class.
 * Since standard GFM doesn't include specific nodes for this, we use a regex matcher.
 */
const markDecorator = new MatchDecorator({
    regexp: /==[^=]+==/g,
    decoration: (_match) =>
        Decoration.mark({
            class: 'cm-highlighted',
        }),
});

export const markPlugin = ViewPlugin.define(
    (view) => ({
        decorations: markDecorator.createDeco(view),
        update(u) {
            this.decorations = markDecorator.updateDeco(u, this.decorations);
        },
    }),
    {
        decorations: (v) => v.decorations,
    }
);

/**
 * Decorates `++insert++` syntax with an underline class.
 * Matches `++text++`.
 */
const insertDecorator = new MatchDecorator({
    regexp: /\+\+[^+]+\+\+/g,
    decoration: (_match) =>
        Decoration.mark({
            class: 'cm-inserted',
        }),
});

export const insertPlugin = ViewPlugin.define(
    (view) => ({
        decorations: insertDecorator.createDeco(view),
        update(u) {
            this.decorations = insertDecorator.updateDeco(u, this.decorations);
        },
    }),
    {
        decorations: (v) => v.decorations,
    }
);
