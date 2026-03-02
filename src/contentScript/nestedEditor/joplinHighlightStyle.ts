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
        tag: tags.comment,
        color: '#6d7086',
    },
    {
        tag: tags.keyword,
        color: '#a626a4',
    },
    {
        tag: tags.literal,
        color: '#037',
    },
    {
        tag: tags.number,
        color: '#986801',
    },
    {
        tag: tags.typeName,
        color: '#986801',
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
        color: '#406be5',
    },
    {
        tag: tags.string,
        color: '#50a14f',
    },
    {
        tag: tags.className,
        color: '#904',
    },
    {
        tag: tags.macroName,
        color: '#986801',
    },
]);

/**
 * Dark theme syntax highlighting colors.
 */
const darkHighlightStyle = HighlightStyle.define([
    ...commonHighlightRules,
    {
        tag: tags.comment,
        color: '#b18eb1',
    },
    {
        tag: tags.keyword,
        color: '#F92672',
    },
    {
        tag: tags.literal,
        color: '#aaf',
    },
    {
        tag: tags.number,
        color: '#d19a66',
    },
    {
        tag: tags.typeName,
        color: '#d19a66',
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
        color: '#61aeee',
    },
    {
        tag: tags.string,
        color: '#98c379',
    },
    {
        tag: tags.className,
        color: '#d8a',
    },
    {
        tag: tags.macroName,
        color: '#e6c07b',
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
