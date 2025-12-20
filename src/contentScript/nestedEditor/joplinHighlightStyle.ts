import { HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

/**
 * Custom highlight style that maps Markdown tokens to Joplin's native CSS variables.
 * This ensures the nested editor looks "native" in both Light and Dark themes.
 */
export const joplinHighlightStyle = HighlightStyle.define([
    {
        tag: tags.link,
        color: 'var(--joplin-url-color, #155BDA)',
        textDecoration: 'underline',
    },
    {
        tag: tags.url,
        color: 'var(--joplin-url-color, #155BDA)',
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
        color: 'var(--joplin-code-color, rgb(0,0,0))',
    },
    {
        tag: tags.monospace,
        color: 'var(--joplin-code-color, rgb(0,0,0))',
        fontFamily: 'monospace !important',
        fontSize: '0.9em',
    },
    {
        tag: tags.comment,
        color: 'var(--joplin-color-faded, #627184)',
    },
    {
        tag: [tags.strikethrough, tags.deleted],
        textDecoration: 'line-through',
    },
    // Generic fallback for keywords (lists, blockquotes markers, etc)
    {
        tag: tags.keyword,
        color: 'var(--joplin-color-warn-url, #155BDA)', // often used for syntax chars in some themes
    },
    {
        tag: tags.meta,
        color: 'var(--joplin-color-faded, #627184)',
    },
]);
