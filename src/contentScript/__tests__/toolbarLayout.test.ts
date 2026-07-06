import { describe, expect, it } from 'vitest';
import {
    getToolbarButtonGroups,
    renderToolbarButtonGroups,
    type ToolbarButtonDescriptor,
} from '../toolbar/toolbarLayout';

function renderLayout(groups: ToolbarButtonDescriptor[][]) {
    const labels: Array<string | null> = [];
    let separatorCount = 0;

    renderToolbarButtonGroups(
        groups,
        (button) => {
            labels.push(button.ariaLabel);
        },
        () => {
            separatorCount += 1;
        }
    );

    return {
        labels,
        separatorCount,
    };
}

describe('toolbarLayout', () => {
    it('renders all optional groups by default', () => {
        const layout = renderLayout(
            getToolbarButtonGroups({
                showMoveButtons: true,
                showClearButtons: true,
                showAlignmentButtons: true,
                showDeleteTableButton: true,
            })
        );

        expect(layout.labels).toEqual([
            'Insert row before',
            'Insert row after',
            'Delete row',
            'Move row up',
            'Move row down',
            'Clear row',
            'Insert column before',
            'Insert column after',
            'Delete column',
            'Move column left',
            'Move column right',
            'Clear column',
            'Align column left',
            'Align column center',
            'Align column right',
            'Clear table',
            'Delete table',
        ]);
        expect(layout.separatorCount).toBe(3);
    });

    it('hides move buttons when the move group is disabled', () => {
        const layout = renderLayout(
            getToolbarButtonGroups({
                showMoveButtons: false,
                showClearButtons: true,
                showAlignmentButtons: true,
                showDeleteTableButton: true,
            })
        );

        expect(layout.labels).not.toContain('Move row up');
        expect(layout.labels).not.toContain('Move column right');
        expect(layout.labels).toContain('Clear table');
        expect(layout.separatorCount).toBe(3);
    });

    it('hides clear row, clear column, and clear table when the clear group is disabled', () => {
        const layout = renderLayout(
            getToolbarButtonGroups({
                showMoveButtons: true,
                showClearButtons: false,
                showAlignmentButtons: true,
                showDeleteTableButton: true,
            })
        );

        expect(layout.labels).not.toContain('Clear row');
        expect(layout.labels).not.toContain('Clear column');
        expect(layout.labels).not.toContain('Clear table');
        expect(layout.labels).toContain('Delete table');
        expect(layout.separatorCount).toBe(3);
    });

    it('hides alignment buttons when the alignment group is disabled', () => {
        const layout = renderLayout(
            getToolbarButtonGroups({
                showMoveButtons: true,
                showClearButtons: true,
                showAlignmentButtons: false,
                showDeleteTableButton: true,
            })
        );

        expect(layout.labels).not.toContain('Align column left');
        expect(layout.labels).not.toContain('Align column center');
        expect(layout.labels).not.toContain('Align column right');
        expect(layout.separatorCount).toBe(2);
    });

    it('keeps only core actions when all optional groups are disabled', () => {
        const layout = renderLayout(
            getToolbarButtonGroups({
                showMoveButtons: false,
                showClearButtons: false,
                showAlignmentButtons: false,
                showDeleteTableButton: true,
            })
        );

        expect(layout.labels).toEqual([
            'Insert row before',
            'Insert row after',
            'Delete row',
            'Insert column before',
            'Insert column after',
            'Delete column',
            'Delete table',
        ]);
        expect(layout.separatorCount).toBe(2);
    });

    it('hides the delete table button when disabled', () => {
        const layout = renderLayout(
            getToolbarButtonGroups({
                showMoveButtons: true,
                showClearButtons: true,
                showAlignmentButtons: true,
                showDeleteTableButton: false,
            })
        );

        expect(layout.labels).toContain('Clear table');
        expect(layout.labels).not.toContain('Delete table');
        expect(layout.separatorCount).toBe(3);
    });

    it('omits the table group when clear and delete table buttons are both disabled', () => {
        const layout = renderLayout(
            getToolbarButtonGroups({
                showMoveButtons: false,
                showClearButtons: false,
                showAlignmentButtons: false,
                showDeleteTableButton: false,
            })
        );

        expect(layout.labels).toEqual([
            'Insert row before',
            'Insert row after',
            'Delete row',
            'Insert column before',
            'Insert column after',
            'Delete column',
        ]);
        expect(layout.separatorCount).toBe(1);
    });
});
