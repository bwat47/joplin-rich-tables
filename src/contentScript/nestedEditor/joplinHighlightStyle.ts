import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { Extension } from '@codemirror/state';

/**
 * Theme-aware syntax highlighting that matches Joplin's native color schemes.
 */

/**
 * Common highlight rules that work for both light and dark themes.
 * These use CSS variables where Joplin provides them, or are styling-only rules.
 */
const commonHighlightRules = [
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
        tag: tags.monospace,
        fontFamily: 'monospace !important',
        fontSize: '0.9em',
    },
    {
        tag: tags.comment,
        opacity: '0.9',
        fontStyle: 'italic',
    },
    {
        tag: tags.strikethrough,
        textDecoration: 'line-through',
    },
    {
        tag: tags.link,
        color: 'var(--joplin-url-color, #155BDA)',
    },
];

/**
 * Light theme syntax highlighting colors.
 */
const lightHighlightStyle = HighlightStyle.define([
    ...commonHighlightRules,
    {
        tag: tags.keyword,
        color: '#740',
    },
    {
        tag: tags.operator,
        color: '#490',
    },
    {
        tag: tags.literal,
        color: '#037',
    },
    {
        tag: tags.typeName,
        color: '#a00',
    },
    {
        tag: tags.inserted,
        color: '#471',
    },
    {
        tag: tags.deleted,
        color: '#a21',
    },
    {
        tag: tags.propertyName,
        color: '#940',
    },
    {
        tag: tags.className,
        color: '#904',
    },
]);

/**
 * Dark theme syntax highlighting colors.
 */
const darkHighlightStyle = HighlightStyle.define([
    ...commonHighlightRules,
    {
        tag: tags.keyword,
        color: '#ff7',
    },
    {
        tag: tags.operator,
        color: '#fa9',
    },
    {
        tag: tags.literal,
        color: '#aaf',
    },
    {
        tag: tags.typeName,
        color: '#7ff',
    },
    {
        tag: tags.inserted,
        color: '#7f7',
    },
    {
        tag: tags.deleted,
        color: '#f96',
    },
    {
        tag: tags.propertyName,
        color: '#d96',
    },
    {
        tag: tags.className,
        color: '#d8a',
    },
]);

/**
 * Creates a syntax highlighting extension that matches Joplin's native theme.
 *
 * @param isDarkTheme - Whether the current Joplin theme is dark
 * @returns CodeMirror extension for syntax highlighting
 */
export function createJoplinSyntaxHighlighting(isDarkTheme: boolean): Extension {
    const style = isDarkTheme ? darkHighlightStyle : lightHighlightStyle;
    return syntaxHighlighting(style, { fallback: true });
}
