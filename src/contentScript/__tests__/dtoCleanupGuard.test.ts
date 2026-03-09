import fs from 'fs';
import path from 'path';

const runtimeRoot = path.join(__dirname, '..');
const bannedPatterns = [
    { label: 'markdownTableParsing import', pattern: /from ['"][^'"]*markdownTableParsing['"]/ },
    { label: 'markdownTableManipulation import', pattern: /from ['"][^'"]*markdownTableManipulation['"]/ },
    { label: 'TableData identifier', pattern: /\bTableData\b/ },
    { label: 'parseMarkdownTable identifier', pattern: /\bparseMarkdownTable\b/ },
    { label: 'serializeTable identifier', pattern: /\bserializeTable\b/ },
];

function collectRuntimeFiles(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
        if (entry.name === '__tests__') {
            continue;
        }

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectRuntimeFiles(fullPath));
            continue;
        }

        if (entry.isFile() && fullPath.endsWith('.ts')) {
            files.push(fullPath);
        }
    }

    return files;
}

describe('dto cleanup guard', () => {
    it('does not allow dto compatibility APIs in runtime code', () => {
        const violations: string[] = [];

        for (const filePath of collectRuntimeFiles(runtimeRoot)) {
            const content = fs.readFileSync(filePath, 'utf8');

            for (const { label, pattern } of bannedPatterns) {
                if (pattern.test(content)) {
                    violations.push(`${path.relative(runtimeRoot, filePath)}: ${label}`);
                }
            }
        }

        expect(violations).toEqual([]);
    });
});
