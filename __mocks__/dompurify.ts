/**
 * Jest mock for DOMPurify.
 * Returns HTML unchanged since we're not testing sanitization behavior.
 */
export default {
    addHook: () => {},
    sanitize: (html: string) => html,
};
