/**
 * Test double for DOMPurify. Sanitization behaviour is not what these tests cover, so the markup
 * passes through unchanged; only the shape of the return value matters, and that has to match the
 * real library so callers can be exercised.
 */
export default {
    addHook: () => {},
    sanitize: (html: string, config?: { RETURN_DOM_FRAGMENT?: boolean }) => {
        if (!config?.RETURN_DOM_FRAGMENT) {
            return html;
        }

        const template = document.createElement('template');
        template.innerHTML = html;
        return template.content;
    },
};
