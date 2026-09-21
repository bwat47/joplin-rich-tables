import type { ToolbarHostConfig } from '../../contentScriptBridge/hostEditorConfigBridge';
import {
    alignCenterIcon,
    alignLeftIcon,
    alignRightIcon,
    clearTableIcon,
    columnInsertLeftIcon,
    columnInsertRightIcon,
    columnRemoveIcon,
    deleteTableIcon,
    moveColumnLeftIcon,
    moveColumnRightIcon,
    moveRowDownIcon,
    moveRowUpIcon,
    rowInsertBottomIcon,
    rowInsertTopIcon,
    rowRemoveIcon,
    sortAscendingIcon,
    sortDescendingIcon,
    type ToolbarIconFactory,
} from './icons';
import type { StructuralActionId } from '../tableRuntime/operations/structuralActions';

export interface ToolbarButtonDescriptor {
    actionId: StructuralActionId;
    label: string;
    iconFactory: ToolbarIconFactory;
}

const baseRowButtons: ToolbarButtonDescriptor[] = [
    {
        actionId: 'insertRowBefore',
        label: 'Insert row before',
        iconFactory: rowInsertTopIcon,
    },
    {
        actionId: 'insertRowAfter',
        label: 'Insert row after',
        iconFactory: rowInsertBottomIcon,
    },
    {
        actionId: 'deleteRow',
        label: 'Delete row',
        iconFactory: rowRemoveIcon,
    },
];

const baseColumnButtons: ToolbarButtonDescriptor[] = [
    {
        actionId: 'insertColumnBefore',
        label: 'Insert column before',
        iconFactory: columnInsertLeftIcon,
    },
    {
        actionId: 'insertColumnAfter',
        label: 'Insert column after',
        iconFactory: columnInsertRightIcon,
    },
    {
        actionId: 'deleteColumn',
        label: 'Delete column',
        iconFactory: columnRemoveIcon,
    },
];

const moveRowButtons: ToolbarButtonDescriptor[] = [
    {
        actionId: 'moveRowUp',
        label: 'Move row up',
        iconFactory: moveRowUpIcon,
    },
    {
        actionId: 'moveRowDown',
        label: 'Move row down',
        iconFactory: moveRowDownIcon,
    },
];

const moveColumnButtons: ToolbarButtonDescriptor[] = [
    {
        actionId: 'moveColumnLeft',
        label: 'Move column left',
        iconFactory: moveColumnLeftIcon,
    },
    {
        actionId: 'moveColumnRight',
        label: 'Move column right',
        iconFactory: moveColumnRightIcon,
    },
];

const clearRowButton: ToolbarButtonDescriptor = {
    actionId: 'clearRow',
    label: 'Clear row',
    iconFactory: clearTableIcon,
};

const clearColumnButton: ToolbarButtonDescriptor = {
    actionId: 'clearColumn',
    label: 'Clear column',
    iconFactory: clearTableIcon,
};

const clearTableButton: ToolbarButtonDescriptor = {
    actionId: 'clearTable',
    label: 'Clear table',
    iconFactory: clearTableIcon,
};

const alignmentButtons: ToolbarButtonDescriptor[] = [
    {
        actionId: 'alignLeft',
        label: 'Align column left',
        iconFactory: alignLeftIcon,
    },
    {
        actionId: 'alignCenter',
        label: 'Align column center',
        iconFactory: alignCenterIcon,
    },
    {
        actionId: 'alignRight',
        label: 'Align column right',
        iconFactory: alignRightIcon,
    },
];

const deleteTableButton: ToolbarButtonDescriptor = {
    actionId: 'deleteTable',
    label: 'Delete table',
    iconFactory: deleteTableIcon,
};

const sortButtons: ToolbarButtonDescriptor[] = [
    {
        actionId: 'sortColumnAscending',
        label: 'Sort rows by column (A to Z)',
        iconFactory: sortAscendingIcon,
    },
    {
        actionId: 'sortColumnDescending',
        label: 'Sort rows by column (Z to A)',
        iconFactory: sortDescendingIcon,
    },
];

export function getToolbarButtonGroups(settings: ToolbarHostConfig): ToolbarButtonDescriptor[][] {
    const rowButtons = [...baseRowButtons];
    const columnButtons = [...baseColumnButtons];

    if (settings.showMoveButtons) {
        rowButtons.push(...moveRowButtons);
        columnButtons.push(...moveColumnButtons);
    }

    if (settings.showClearButtons) {
        rowButtons.push(clearRowButton);
        columnButtons.push(clearColumnButton);
    }

    const tableButtons = [
        ...(settings.showClearButtons ? [clearTableButton] : []),
        ...(settings.showDeleteTableButton ? [deleteTableButton] : []),
    ];
    const groups: ToolbarButtonDescriptor[][] = [rowButtons, columnButtons];

    if (settings.showAlignmentButtons) {
        groups.push(alignmentButtons);
    }

    if (settings.showSortButtons) {
        groups.push(sortButtons);
    }

    if (tableButtons.length > 0) {
        groups.push(tableButtons);
    }

    return groups;
}

export function renderToolbarButtonGroups(
    groups: ToolbarButtonDescriptor[][],
    renderButton: (button: ToolbarButtonDescriptor) => void,
    renderSeparator: () => void
): void {
    groups.forEach((group, groupIndex) => {
        group.forEach(renderButton);

        if (groupIndex < groups.length - 1) {
            renderSeparator();
        }
    });
}
