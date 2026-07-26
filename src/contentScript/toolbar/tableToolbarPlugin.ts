import { ViewPlugin, ViewUpdate, EditorView } from '@codemirror/view';
import { activeCellField, type ActiveCell } from '../tableState/activeCellState';
import { computePosition, autoUpdate, offset, shift, hide } from '@floating-ui/dom';
import { syncAnnotation } from '../editorBridge/syncAnnotation';
import { rebuildTableWidgetsEffect } from '../tableState/tableWidgetEffects';
import { CLASS_FLOATING_TOOLBAR } from '../tableWidget/domHelpers';
import { findTableWidgetElement } from '../tableWidget/domHelpers';
import { makeTableId } from '../tableModel/types';
import { getToolbarButtonGroups, renderToolbarButtonGroups, type ToolbarActionId } from './toolbarLayout';
import { getDocumentWindow, getViewDocument } from '../shared/domContext';
import { clamp } from '../shared/numberUtils';
import { isNestedEditorOpen, refocusNestedEditor } from '../nestedEditor/nestedEditorController';
import { getResolvedActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import { runStructuralAction } from '../tableRuntime/operations/structuralActions';
import { hostEditorConfigFacet } from '../services/hostEditorConfig';

export class TableToolbarPlugin {
    dom: HTMLElement;
    private currentActiveCell: ActiveCell | null = null;
    private cleanupAutoUpdate: (() => void) | null = null;
    private cleanupViewportListeners: (() => void) | null = null;
    private buttonsInitialized = false;
    private destroyed = false;

    constructor(private view: EditorView) {
        const doc = getViewDocument(view);
        this.dom = doc.createElement('div');
        this.dom.className = CLASS_FLOATING_TOOLBAR;
        this.dom.style.position = 'absolute';
        this.dom.style.display = 'none';

        view.dom.appendChild(this.dom);
    }

    update(update: ViewUpdate) {
        const prevActiveCell = this.currentActiveCell;
        this.currentActiveCell = update.state.field(activeCellField);

        // Active cell state changed
        if (!!prevActiveCell !== !!this.currentActiveCell) {
            if (this.currentActiveCell) {
                // Defer until widget DOM is ready (runs in CM's measure cycle after DOM update)
                this.schedulePositionUpdate();
            } else {
                this.cleanupPositioning();
                this.hideToolbar();
            }
            return;
        }

        // Active cell changed to different table
        if (this.currentActiveCell && prevActiveCell && this.currentActiveCell.tableFrom !== prevActiveCell.tableFrom) {
            // Defer until new table widget DOM is ready
            this.schedulePositionUpdate();
            return;
        }

        // Check for conditions that usually imply the widget DOM was replaced/rebuilt:
        // 1. rebuildTableWidgetsEffect (explicit structural edit)
        // 2. Doc changes that are NOT sync (e.g. Undo/Redo, external edits).
        //    Non-sync changes cause `tableDecorationField` to rebuild decorations,
        //    which leads to CodeMirror replacing the widget DOM if content changed.
        const isNonSyncDocChange = update.transactions.some((tr) => tr.docChanged && !tr.annotation(syncAnnotation));
        const hasRebuildEffect = update.transactions.some((tr) =>
            tr.effects.some((e) => e.is(rebuildTableWidgetsEffect))
        );

        if (this.currentActiveCell && (hasRebuildEffect || isNonSyncDocChange)) {
            // Defer until rebuilt widget DOM is ready
            this.schedulePositionUpdate();
        }

        // Note: autoUpdate handles other cases (scroll/resize)
    }

    destroy() {
        this.destroyed = true;
        this.cleanupPositioning();
        this.dom.remove();
    }

    private ensureButtonsInitialized() {
        if (this.buttonsInitialized) {
            return;
        }

        if (this.destroyed) {
            return;
        }

        this.createButtons();
        this.buttonsInitialized = true;
    }

    private createButtons() {
        const doc = getViewDocument(this.view);
        // `innerHTML = ''` rather than `replaceChildren()`: the latter needs
        // Chrome 86 / Safari 14, above this plugin's mobile WebView baseline.
        // See the ES2020 runtime note in AGENTS.md.
        this.dom.innerHTML = '';

        const createIconBtn = (title: string, ariaLabel: string, svg: SVGSVGElement, onClick: () => boolean) => {
            const btn = doc.createElement('button');
            btn.title = title;
            btn.className = 'cm-table-toolbar-btn';
            btn.type = 'button';
            btn.setAttribute('aria-label', ariaLabel);
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (onClick() === false) {
                    this.restoreNestedEditorFocusAfterNoop();
                }
            });
            btn.appendChild(svg);
            btn.classList.add('cm-table-toolbar-icon-btn');
            this.dom.appendChild(btn);
        };

        const createSeparator = () => {
            const sep = doc.createElement('span');
            sep.className = 'cm-table-toolbar-separator';
            this.dom.appendChild(sep);
        };

        renderToolbarButtonGroups(
            getToolbarButtonGroups(this.view.state.facet(hostEditorConfigFacet).toolbar),
            (button) => {
                createIconBtn(
                    button.title,
                    button.ariaLabel,
                    button.iconFactory(doc),
                    this.getActionHandler(button.actionId)
                );
            },
            createSeparator
        );
    }

    private getActionHandler(actionId: ToolbarActionId): () => boolean {
        return () => {
            if (!this.currentActiveCell) {
                return false;
            }

            const resolvedCell = getResolvedActiveCell(this.view.state);
            if (!resolvedCell) {
                return false;
            }

            return runStructuralAction(this.view, actionId, resolvedCell);
        };
    }

    private restoreNestedEditorFocusAfterNoop() {
        if (!this.currentActiveCell || !isNestedEditorOpen(this.view)) {
            return;
        }

        refocusNestedEditor(this.view);
    }

    private showToolbar() {
        this.dom.style.display = 'flex';
        this.dom.style.visibility = 'visible';
    }

    private hideToolbar() {
        // We use display: none to ensure it is removed from the layout/paint immediately.
        // This prevents "ghosting" or lingering 1-frame artifacts.
        this.dom.style.display = 'none';
        this.dom.style.visibility = 'hidden';
    }

    private prepareToolbarForPositioning() {
        // Floating UI requires the element to be rendered (not display:none).
        // Start hidden to avoid flicker until we have a positioned x/y.
        this.dom.style.display = 'flex';
        this.dom.style.visibility = 'hidden';
        // Defensive: ensure a stable initial layout for measurement.
        if (!this.dom.style.left) this.dom.style.left = '0px';
        if (!this.dom.style.top) this.dom.style.top = '0px';
    }

    private cleanupPositioning() {
        if (this.cleanupAutoUpdate) {
            this.cleanupAutoUpdate();
            this.cleanupAutoUpdate = null;
        }
        if (this.cleanupViewportListeners) {
            this.cleanupViewportListeners();
            this.cleanupViewportListeners = null;
        }
    }

    /**
     * Schedules a position update using CodeMirror's measure cycle.
     * Runs after DOM updates are complete, in the same frame.
     * Using `key` dedupes multiple requests within the same update cycle.
     */
    private schedulePositionUpdate() {
        this.view.requestMeasure({
            key: this,
            read: () => null,
            write: () => {
                void this.updatePosition();
            },
        });
    }

    private async updatePosition() {
        if (!this.currentActiveCell) {
            this.cleanupPositioning();
            this.hideToolbar();
            return;
        }

        this.ensureButtonsInitialized();
        if (this.destroyed || !this.currentActiveCell) {
            this.cleanupPositioning();
            this.hideToolbar();
            return;
        }

        const referenceElement = findTableWidgetElement(this.view, makeTableId(this.currentActiveCell.tableFrom));

        if (!referenceElement) {
            this.cleanupPositioning();
            this.hideToolbar();
            return;
        }

        this.cleanupPositioning();
        this.prepareToolbarForPositioning();

        const scrollDOM = this.view.scrollDOM;
        const doc = getViewDocument(this.view);
        const viewWindow = getDocumentWindow(doc);
        const isInternalScroll = scrollDOM.scrollHeight > scrollDOM.clientHeight + 1;
        if (!isInternalScroll) {
            // External scroll (mobile) doesn't reliably trigger autoUpdate's ancestor scroll handlers.
            this.cleanupViewportListeners = this.attachViewportListeners();
        }

        this.cleanupAutoUpdate = autoUpdate(
            referenceElement,
            this.dom,
            async () => {
                // Ensure element is measurable (display:flex) but hidden (visibility:hidden)
                // before asking Floating UI to compute position.
                this.prepareToolbarForPositioning();

                // Check if reference element is still in the DOM
                if (!referenceElement.isConnected) {
                    // Don't cleanup here - just hide and let the next update() call handle cleanup
                    this.hideToolbar();
                    return;
                }

                const toolbarRect = this.dom.getBoundingClientRect();
                const tableRect = referenceElement.getBoundingClientRect();
                const scrollDOMRect = scrollDOM.getBoundingClientRect();
                // Desktop uses internal CM scrolling; mobile uses external WebView scrolling.
                // For internal scroll, the visible viewport is the scrollDOM rect.
                // For external scroll, use visualViewport/window dimensions anchored to the page.
                const visualViewport = viewWindow.visualViewport;
                const viewportHeight = isInternalScroll
                    ? scrollDOMRect.height
                    : (visualViewport?.height ?? viewWindow.innerHeight);
                const viewportTop = isInternalScroll ? scrollDOMRect.top : 0;
                const viewportBottom = isInternalScroll ? scrollDOMRect.bottom : viewportHeight;

                const tableAboveViewport = tableRect.bottom <= viewportTop;
                const tableBelowViewport = tableRect.top >= viewportBottom;

                if (tableAboveViewport || tableBelowViewport) {
                    this.hideToolbar();
                    return;
                }

                const topVisible = tableRect.top >= viewportTop && tableRect.top <= viewportBottom;
                const bottomVisible = tableRect.bottom >= viewportTop && tableRect.bottom <= viewportBottom;
                const hasRoomAbove =
                    tableRect.top - toolbarRect.height - TOOLBAR_OFFSET_PX >= viewportTop + TOOLBAR_VIEWPORT_PADDING_PX;
                const hasRoomBelow =
                    viewportBottom - tableRect.bottom - toolbarRect.height - TOOLBAR_OFFSET_PX >=
                    TOOLBAR_VIEWPORT_PADDING_PX;

                let result = null as Awaited<ReturnType<typeof computePosition>> | null;
                let manualPosition = null as { x: number; y: number; fixed?: boolean } | null;

                const middleware = [offset(TOOLBAR_OFFSET_PX), shift({ padding: TOOLBAR_VIEWPORT_PADDING_PX }), hide()];

                if (topVisible && hasRoomAbove) {
                    result = await computePosition(referenceElement, this.dom, {
                        placement: 'top-start',
                        middleware,
                    });
                } else if (bottomVisible && hasRoomBelow) {
                    result = await computePosition(referenceElement, this.dom, {
                        placement: 'bottom-start',
                        middleware,
                    });
                } else {
                    // Pinned mode: toolbar sticks to viewport edge when table top/bottom is out of view.
                    const placeAbove = (tableRect.top + tableRect.bottom) / 2 > viewportTop + viewportHeight / 2;

                    if (isInternalScroll) {
                        // Desktop (internal scroll): use position: absolute with offset parent calculations
                        // to keep the toolbar within the editor panel bounds.
                        const viewRect = this.view.dom.getBoundingClientRect();
                        const offsetParent = (this.dom.offsetParent ?? doc.body) as HTMLElement;
                        const offsetParentRect = offsetParent.getBoundingClientRect();

                        const minX = TOOLBAR_VIEWPORT_PADDING_PX;
                        const maxX = Math.max(
                            TOOLBAR_VIEWPORT_PADDING_PX,
                            viewRect.width - toolbarRect.width - TOOLBAR_VIEWPORT_PADDING_PX
                        );
                        const x = clamp(tableRect.left - viewRect.left, minX, maxX);

                        const topInParent = viewportTop - offsetParentRect.top + TOOLBAR_VIEWPORT_PADDING_PX;
                        const bottomInParent =
                            viewportBottom - offsetParentRect.top - toolbarRect.height - TOOLBAR_VIEWPORT_PADDING_PX;
                        const y = placeAbove ? topInParent : Math.max(topInParent, bottomInParent);
                        manualPosition = { x, y, fixed: false };
                    } else {
                        // Mobile (external scroll): use position: fixed with viewport-relative coordinates
                        // to avoid jitter caused by offset parent recalculations during scroll.
                        // Mobile editor disables pinch-zoom (maximum-scale=1), so pageLeft should be 0.
                        const viewportWidth = visualViewport?.width ?? viewWindow.innerWidth;
                        const minX = TOOLBAR_VIEWPORT_PADDING_PX;
                        const maxX = Math.max(
                            TOOLBAR_VIEWPORT_PADDING_PX,
                            viewportWidth - toolbarRect.width - TOOLBAR_VIEWPORT_PADDING_PX
                        );
                        const x = clamp(tableRect.left, minX, maxX);

                        const y = placeAbove
                            ? viewportTop + TOOLBAR_VIEWPORT_PADDING_PX
                            : viewportBottom - toolbarRect.height - TOOLBAR_VIEWPORT_PADDING_PX;

                        manualPosition = { x, y, fixed: true };
                    }
                }

                if (result?.middlewareData.hide?.referenceHidden) {
                    this.hideToolbar();
                    return;
                }

                // Avoid rendering if we somehow produced a non-finite position.
                if (
                    (result && (!Number.isFinite(result.x) || !Number.isFinite(result.y))) ||
                    (manualPosition && (!Number.isFinite(manualPosition.x) || !Number.isFinite(manualPosition.y)))
                ) {
                    this.hideToolbar();
                    return;
                }

                // If we positioned relative to the table, keep the existing obscuration guard.
                if (result && result.placement.startsWith('top') && result.y < TOOLBAR_OBSCURATION_THRESHOLD_PX) {
                    const fallback = await computePosition(referenceElement, this.dom, {
                        placement: 'bottom-start',
                        middleware,
                    });
                    if (!fallback.middlewareData.hide?.referenceHidden) {
                        result = fallback;
                    }
                }

                this.showToolbar();
                if (manualPosition) {
                    Object.assign(this.dom.style, {
                        position: manualPosition.fixed ? 'fixed' : 'absolute',
                        left: `${manualPosition.x}px`,
                        top: `${manualPosition.y}px`,
                    });
                    return;
                }

                if (!result) {
                    this.hideToolbar();
                    return;
                }

                // Reset to absolute positioning for Floating UI results
                this.dom.style.position = 'absolute';
                Object.assign(this.dom.style, {
                    left: `${result.x}px`,
                    top: `${result.y}px`,
                });
            },
            {
                ancestorScroll: true,
                ancestorResize: true,
                elementResize: true,
                layoutShift: true,
                animationFrame: false,
            }
        );
    }

    private attachViewportListeners() {
        const doc = getViewDocument(this.view);
        const viewWindow = getDocumentWindow(doc);
        const handler = () => {
            this.schedulePositionUpdate();
        };

        doc.addEventListener('scroll', handler, { passive: true });
        viewWindow.addEventListener('resize', handler);
        viewWindow.visualViewport?.addEventListener('scroll', handler);
        viewWindow.visualViewport?.addEventListener('resize', handler);

        return () => {
            doc.removeEventListener('scroll', handler);
            viewWindow.removeEventListener('resize', handler);
            viewWindow.visualViewport?.removeEventListener('scroll', handler);
            viewWindow.visualViewport?.removeEventListener('resize', handler);
        };
    }
}

const TOOLBAR_OFFSET_PX = 5;
const TOOLBAR_VIEWPORT_PADDING_PX = 5;
const TOOLBAR_OBSCURATION_THRESHOLD_PX = 5;

export const tableToolbarPlugin = ViewPlugin.fromClass(TableToolbarPlugin);

export const tableToolbarTheme = EditorView.baseTheme({
    [`.${CLASS_FLOATING_TOOLBAR}`]: {
        position: 'absolute',
        backgroundColor: 'var(--rt-toolbar-bg)',
        border: '1px solid var(--rt-border-color)',
        borderRadius: '6px',
        padding: '4px',
        boxShadow: '0 4px 12px var(--rt-toolbar-shadow)',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '4px',
        alignItems: 'center',
        maxWidth: 'calc(100vw - 16px)',
        zIndex: '100',
        fontSize: '13px',
    },
    '.cm-table-toolbar-btn': {
        background: 'none',
        border: '1px solid transparent',
        borderRadius: '4px',
        cursor: 'pointer',
        padding: '4px 8px',
        fontSize: 'inherit',
        color: 'var(--rt-toolbar-color)',
        whiteSpace: 'nowrap',
        transition: 'background-color 0.2s, color 0.2s, border-color 0.2s',
    },
    '.cm-table-toolbar-btn .cm-table-toolbar-icon': {
        width: '18px',
        height: '18px',
        display: 'block',
    },
    '.cm-table-toolbar-icon-btn': {
        padding: '4px 6px',
        lineHeight: '0',
    },
    '.cm-table-toolbar-btn:hover': {
        backgroundColor: 'var(--rt-toolbar-hover-bg)',
        borderColor: 'var(--rt-border-color)',
    },
    '.cm-table-toolbar-separator': {
        width: '1px',
        height: '18px',
        backgroundColor: 'var(--rt-border-color)',
        margin: '0 4px',
    },
});
