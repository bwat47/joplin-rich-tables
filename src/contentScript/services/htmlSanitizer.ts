import DOMPurify from 'dompurify';

const IFRAME_TAG = 'iframe';

/**
 * Tags dropped on top of DOMPurify's defaults.
 *
 * `form` is default-allowed but has no use inside a table cell, and DOMPurify avoids adopting the
 * nodes it returns precisely because a form element's internal state (its past names map) survives
 * the move between documents. Removing it keeps that out of the fragment we adopt.
 */
const FORBIDDEN_TAGS = ['form'];

const YOUTUBE_EMBED_ALLOWED_HOSTS = new Set<string>([
    'www.youtube-nocookie.com',
    'youtube-nocookie.com',
    'www.youtube.com',
    'youtube.com',
]);

const YOUTUBE_EMBED_PATH_REGEX = /^\/embed\/[A-Za-z0-9_-]{11}$/;

function isAllowedYouTubeEmbedSrc(src: string): boolean {
    try {
        const url = new URL(src, 'https://invalid.example');
        if (url.protocol !== 'https:') {
            return false;
        }

        if (!YOUTUBE_EMBED_ALLOWED_HOSTS.has(url.hostname)) {
            return false;
        }

        return YOUTUBE_EMBED_PATH_REGEX.test(url.pathname);
    } catch {
        return false;
    }
}

/**
 * Configure DOMPurify hooks once globally to avoid re-adding them on every render.
 */
DOMPurify.addHook('afterSanitizeElements', (node) => {
    // Only allow trusted YouTube embed iframes; remove everything else.
    if (node instanceof Element && node.tagName === 'IFRAME') {
        const src = node.getAttribute('src');
        if (!src || !isAllowedYouTubeEmbedSrc(src)) {
            node.remove();
        }
    }
});

/**
 * Sanitize HTML rendered by Joplin to ensure security and fix display issues.
 * - Allows specific attributes needed for internal links/images/videos
 * - Allows unknown protocols for joplin-content://
 * - Drops `<form>`, which DOMPurify allows by default
 * - Relies on DOMPurify's safe defaults to block dangerous tags/attributes
 *
 * Returns nodes rather than a string: DOMPurify has to parse the markup either way, so handing
 * back the tree it already built saves serializing it and parsing it again to display it. The
 * nodes belong to DOMPurify's own document until something appends them, which adopts them.
 */
export function sanitizeToFragment(html: string): DocumentFragment {
    return DOMPurify.sanitize(html, {
        RETURN_DOM_FRAGMENT: true,
        ALLOW_UNKNOWN_PROTOCOLS: true,
        ADD_TAGS: [IFRAME_TAG],
        ADD_ATTR: [
            'data-resource-id',
            'data-note-id',
            'data-item-id',
            'data-from-md',
            'src',
            'title',
            'frameborder',
            'allowfullscreen',
            'allow',
            'loading',
            'referrerpolicy',
        ],
        FORBID_TAGS: FORBIDDEN_TAGS,
        FORBID_ATTR: ['srcdoc'],
    });
}
