/**
 * Mock for @joplin/fork-uslug used in tests.
 * Simple slugification for test purposes.
 */
function uslug(text: string): string {
    return text
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\w-]/g, '');
}

module.exports = uslug;
