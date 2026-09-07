import { markdown } from '@codemirror/lang-markdown';
import { EditorState, type Extension } from '@codemirror/state';
import { GFM, type InlineContext, type MarkdownConfig } from '@lezer/markdown';

const EQUALS_SIGN = 61;
const PLUS_SIGN = 43;

const isSpaceOrEmpty = (text: string): boolean => /^\s*$/.test(text);

/**
 * A double-character inline construct, mirroring the `==mark==` and `++insert++` parsers Joplin
 * adds to the host editor. Reproduced here because the plugin reads the host's tree and the
 * markers only exist there; kept deliberately close to Joplin's own extension.
 */
function doubleCharConfig(charCode: number, name: string, markName: string): MarkdownConfig {
    const delimiter = { resolve: name, mark: markName };
    return {
        defineNodes: [{ name }, { name: markName }],
        parseInline: [
            {
                name,
                parse(cx: InlineContext, current: number, pos: number): number {
                    if (current !== charCode || cx.char(pos + 1) !== charCode || cx.char(pos + 2) === charCode) {
                        return -1;
                    }
                    const canStart = !isSpaceOrEmpty(cx.slice(pos + 2, pos + 3));
                    const canEnd = !isSpaceOrEmpty(cx.slice(pos - 1, pos));
                    if (!canStart && !canEnd) {
                        return -1;
                    }
                    return cx.addDelimiter(delimiter, pos, pos + 2, canStart, canEnd);
                },
            },
        ],
    };
}

/** The host's optional inline extensions, both on by default in Joplin. */
export const hostMarkdownExtensions = [
    doubleCharConfig(EQUALS_SIGN, 'Highlight', 'HighlightMarker'),
    doubleCharConfig(PLUS_SIGN, 'Insert', 'InsertMarker'),
];

export function createMarkdownState(doc: string, extensions: Extension[] = []): EditorState {
    return EditorState.create({
        doc,
        extensions: [
            markdown({
                extensions: [GFM, ...hostMarkdownExtensions],
            }),
            ...extensions,
        ],
    });
}
