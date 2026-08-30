import { Decoration, DecorationSet, EditorView, MatchDecorator, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { Range } from '@codemirror/state';
import type { SyntaxNodeRef } from '@lezer/common';
import { CLASS_NESTED_EDITOR_URL } from '../shared/tableDomClasses';

const INLINE_CODE_NODE_NAME = 'InlineCode';
const LINK_NODE_NAME = 'Link';
const IMAGE_NODE_NAME = 'Image';
const URL_NODE_NAME = 'URL';

type SyntaxNodePredicate = (node: SyntaxNodeRef) => boolean;

function computeSyntaxMarkDecorations(
    view: EditorView,
    className: string,
    matches: SyntaxNodePredicate
): DecorationSet {
    const marks: Range<Decoration>[] = [];
    const tree = syntaxTree(view.state);
    for (const { from, to } of view.visibleRanges) {
        tree.iterate({
            from,
            to,
            enter: (node) => {
                if (matches(node)) {
                    marks.push(Decoration.mark({ class: className }).range(node.from, node.to));
                }
            },
        });
    }

    return Decoration.set(marks);
}

/**
 * Builds a ViewPlugin that marks every syntax node matching `matches` with `className`.
 *
 * Decorations are only recomputed on doc/viewport changes, not on late parse completion.
 * That is safe because `nestedEditorController` warms the parse tree with `ensureSyntaxTree`
 * before mounting the view, so the first computation already sees a complete tree.
 */
function createSyntaxMarkPlugin(className: string, matches: SyntaxNodePredicate) {
    return ViewPlugin.define(
        (view) => ({
            decorations: computeSyntaxMarkDecorations(view, className, matches),
            update(update: ViewUpdate) {
                if (update.docChanged || update.viewportChanged) {
                    this.decorations = computeSyntaxMarkDecorations(update.view, className, matches);
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
export const inlineCodePlugin = createSyntaxMarkPlugin('cm-inline-code', (node) => node.name === INLINE_CODE_NODE_NAME);

const WRAPPED_DESTINATION_PARENTS = new Set([LINK_NODE_NAME, IMAGE_NODE_NAME]);

/**
 * Marks only the destinations in `[label](destination)` links and `![alt](destination)`
 * images, so the theme rule for `CLASS_NESTED_EDITOR_URL` in `nestedEditorTheme.ts` can wrap
 * them aggressively. That `overflow-wrap: anywhere` rule is the actual fix; this plugin only
 * tags the ranges. Bare URLs are excluded: they render in full, so the rendered cell already
 * reserves their width.
 */
export const linkDestinationWrapPlugin = createSyntaxMarkPlugin(CLASS_NESTED_EDITOR_URL, (node) => {
    const parentName = node.node.parent?.name;
    return node.name === URL_NODE_NAME && parentName !== undefined && WRAPPED_DESTINATION_PARENTS.has(parentName);
});

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
