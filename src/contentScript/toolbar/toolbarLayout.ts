import type { ToolbarSettings } from '../../contentScriptBridge/toolbarSettingsBridge';
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
} from './icons';
import type { StructuralActionId } from '../tableRuntime/operations/structuralActions';

export type ToolbarActionId = StructuralActionId;

export interface ToolbarButtonDescriptor {
    actionId: ToolbarActionId;
    title: string;
    ariaLabel: string;
    iconFactory: (doc: Document) => SVGSVGElement;
}

const baseRowButtons: ToolbarButtonDescriptor[] = [
    {
        actionId: 'insertRowBefore',
        title: 'Insert row before',
        ariaLabel: 'Insert row before',
        iconFactory: rowInsertTopIcon,
    },
    {
        actionId: 'insertRowAfter',
        title: 'Insert row after',
        ariaLabel: 'Insert row after',
        iconFactory: rowInsertBottomIcon,
    },
    {
        actionId: 'deleteRow',
        title: 'Delete row',
        ariaLabel: 'Delete row',
        iconFactory: rowRemoveIcon,
    },
];

const baseColumnButtons: ToolbarButtonDescriptor[] = [
    {
        actionId: 'insertColumnBefore',
        title: 'Insert column before',
        ariaLabel: 'Insert column before',
        iconFactory: columnInsertLeftIcon,
    },
    {
        actionId: 'insertColumnAfter',
        title: 'Insert column after',
        ariaLabel: 'Insert column after',
        iconFactory: columnInsertRightIcon,
    },
    {
        actionId: 'deleteColumn',
        title: 'Delete column',
        ariaLabel: 'Delete column',
        iconFactory: columnRemoveIcon,
    },
];

const moveRowButtons: ToolbarButtonDescriptor[] = [
    {
        actionId: 'moveRowUp',
        title: 'Move row up',
        ariaLabel: 'Move row up',
        iconFactory: moveRowUpIcon,
    },
    {
        actionId: 'moveRowDown',
        title: 'Move row down',
        ariaLabel: 'Move row down',
        iconFactory: moveRowDownIcon,
    },
];

const moveColumnButtons: ToolbarButtonDescriptor[] = [
    {
        actionId: 'moveColumnLeft',
        title: 'Move column left',
        ariaLabel: 'Move column left',
        iconFactory: moveColumnLeftIcon,
    },
    {
        actionId: 'moveColumnRight',
        title: 'Move column right',
        ariaLabel: 'Move column right',
        iconFactory: moveColumnRightIcon,
    },
];

const clearRowButton: ToolbarButtonDescriptor = {
    actionId: 'clearRow',
    title: 'Clear row',
    ariaLabel: 'Clear row',
    iconFactory: clearTableIcon,
};

const clearColumnButton: ToolbarButtonDescriptor = {
    actionId: 'clearColumn',
    title: 'Clear column',
    ariaLabel: 'Clear column',
    iconFactory: clearTableIcon,
};

const clearTableButton: ToolbarButtonDescriptor = {
    actionId: 'clearTable',
    title: 'Clear table',
    ariaLabel: 'Clear table',
    iconFactory: clearTableIcon,
};

const alignmentButtons: ToolbarButtonDescriptor[] = [
    {
        actionId: 'alignLeft',
        title: 'Align left',
        ariaLabel: 'Align column left',
        iconFactory: alignLeftIcon,
    },
    {
        actionId: 'alignCenter',
        title: 'Align center',
        ariaLabel: 'Align column center',
        iconFactory: alignCenterIcon,
    },
    {
        actionId: 'alignRight',
        title: 'Align right',
        ariaLabel: 'Align column right',
        iconFactory: alignRightIcon,
    },
];

const deleteTableButtons: ToolbarButtonDescriptor[] = [
    {
        actionId: 'deleteTable',
        title: 'Delete table',
        ariaLabel: 'Delete table',
        iconFactory: deleteTableIcon,
    },
];

export function getToolbarButtonGroups(settings: ToolbarSettings): ToolbarButtonDescriptor[][] {
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

    const tableButtons = settings.showClearButtons
        ? [clearTableButton, ...deleteTableButtons]
        : [...deleteTableButtons];
    const groups: ToolbarButtonDescriptor[][] = [rowButtons, columnButtons];

    if (settings.showAlignmentButtons) {
        groups.push(alignmentButtons);
    }

    groups.push(tableButtons);

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
