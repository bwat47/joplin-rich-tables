import { HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

/**
 * Custom highlight style that maps Markdown tokens to Joplin's native CSS variables.
 * This ensures the nested editor looks "native" in both Light and Dark themes.
 */
export const joplinHighlightStyle = HighlightStyle.define([
    {
        tag: tags.link,
        color: 'var(--joplin-url-color)',
        textDecoration: 'underline',
    },
    {
        tag: tags.url,
        color: 'var(--joplin-url-color)',
        textDecoration: 'underline',
    },
    {
        tag: tags.strong,
        fontWeight: 'bold',
    },
    {
        tag: tags.emphasis,
        fontStyle: 'italic',
    },
    {
        tag: tags.heading,
        fontWeight: 'bold',
    },
    {
        tag: tags.quote,
        color: 'var(--joplin-code-color)',
    },
    {
        tag: tags.monospace,
        border: '1px solid var(--joplin-divider-color)',
        color: 'var(--joplin-code-color)',
        borderRadius: '3px',
        padding: '2px 4px',
        fontFamily: 'monospace !important',
        fontSize: '0.9em',
    },
    {
        tag: tags.comment,
        color: 'var(--joplin-color-faded)',
    },
    // Generic fallback for keywords (lists, blockquotes markers, etc)
    {
        tag: tags.keyword,
        color: 'var(--joplin-color-warn-url)', // often used for syntax chars in some themes
    },
    {
        tag: tags.meta,
        color: 'var(--joplin-color-faded)',
    },
]);
