import { Decoration, DecorationSet, EditorView, MatchDecorator, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { Range } from '@codemirror/state';
import type { SyntaxNodeRef } from '@lezer/common';
import { CLASS_NESTED_EDITOR_LINK } from '../shared/tableDomClasses';

const INLINE_CODE_NODE_NAME = 'InlineCode';
const LINK_NODE_NAME = 'Link';
const IMAGE_NODE_NAME = 'Image';
const URL_NODE_NAME = 'URL';

const LINK_NODE_NAMES = new Set([LINK_NODE_NAME, IMAGE_NODE_NAME]);

/** Returns the class to mark `node` with, or `null` to leave it undecorated. */
type SyntaxNodeClassifier = (node: SyntaxNodeRef) => string | null;

function computeSyntaxMarkDecorations(view: EditorView, classify: SyntaxNodeClassifier): DecorationSet {
    const marks: Range<Decoration>[] = [];
    const tree = syntaxTree(view.state);
    for (const { from, to } of view.visibleRanges) {
        tree.iterate({
            from,
            to,
            enter: (node) => {
                const className = classify(node);
                if (className !== null) {
                    marks.push(Decoration.mark({ class: className }).range(node.from, node.to));
                }
            },
        });
    }

    // Sorted rather than assumed ordered: `visibleRanges` is iterated separately per range.
    return Decoration.set(marks, true);
}

/**
 * Builds a ViewPlugin that marks every syntax node `classify` returns a class for.
 *
 * Decorations are only recomputed on doc/viewport changes, not on late parse completion.
 * That is safe because `nestedEditorController` warms the parse tree with `ensureSyntaxTree`
 * before mounting the view, so the first computation already sees a complete tree.
 */
function createSyntaxMarkPlugin(classify: SyntaxNodeClassifier) {
    return ViewPlugin.define(
        (view) => ({
            decorations: computeSyntaxMarkDecorations(view, classify),
            update(update: ViewUpdate) {
                if (update.docChanged || update.viewportChanged) {
                    this.decorations = computeSyntaxMarkDecorations(update.view, classify);
                }
            },
        }),
        {
            decorations: (plugin) => plugin.decorations,
        }
    );
}

/**
 * Decorates the entire `InlineCode` syntax node (including backticks) with a unified class.
 * allowing for a continuous border/background around the whole segment.
 */
export const inlineCodePlugin = createSyntaxMarkPlugin((node) =>
    node.name === INLINE_CODE_NODE_NAME ? 'cm-inline-code' : null
);

/**
 * Marks `[label](destination)` links and `![alt](destination)` images so the theme rule for
 * `CLASS_NESTED_EDITOR_LINK` in `nestedEditorTheme.ts` can wrap them aggressively, keeping them
 * inside the width cap `tableStyles.ts` puts on the editor.
 *
 * The whole node is marked, not just the destination: `.cm-content` is a flex item, so its
 * automatic minimum size is its min-content width, and a label with no spaces would hold that
 * above the cap and be clipped by the hidden scroller rather than wrapped.
 *
 * Only nodes with a destination qualify, which excludes bare URLs and autolinks (they render in
 * full, so the rendered cell already reserves their width) along with reference links, whose
 * source is no wider than what it renders to.
 */
export const linkWrapPlugin = createSyntaxMarkPlugin((node) =>
    LINK_NODE_NAMES.has(node.name) && node.node.getChild(URL_NODE_NAME) !== null ? CLASS_NESTED_EDITOR_LINK : null
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
