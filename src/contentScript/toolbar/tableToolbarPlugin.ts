import { ViewPlugin, ViewUpdate, EditorView } from '@codemirror/view';
import { activeCellField, type ActiveCell } from '../tableState/activeCellState';
import {
    computePosition,
    autoUpdate,
    offset,
    shift,
    hide,
    type Middleware,
    type VirtualElement,
} from '@floating-ui/dom';
import { syncAnnotation } from '../editorBridge/syncAnnotation';
import { rebuildTableWidgetsEffect } from '../tableState/tableWidgetEffects';
import { CLASS_FLOATING_TOOLBAR } from '../tableWidget/domHelpers';
import { findTableWidgetElement, findWidgetTableElement } from '../tableWidget/domHelpers';
import { makeTableId } from '../tableModel/types';
import { getToolbarButtonGroups, renderToolbarButtonGroups, type ToolbarActionId } from './toolbarLayout';
import { getDocumentWindow, getViewDocument } from '../shared/domContext';
import { isNestedEditorOpen, refocusNestedEditor } from '../nestedEditor/nestedEditorController';
import { getResolvedActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import { runStructuralAction } from '../tableRuntime/operations/structuralActions';
import { hostEditorConfigFacet } from '../services/hostEditorConfig';
import {
    computePinnedAbsolutePlacement,
    computePinnedFixedPlacement,
    isFinitePoint,
    isObscuringTopPlacement,
    isTableOutsideViewport,
    resolveToolbarAnchorRect,
    resolveToolbarPlacementMode,
    shouldPinAbove,
    TOOLBAR_OFFSET_PX,
    TOOLBAR_VIEWPORT_PADDING_PX,
    type ToolbarPlacement,
    type ToolbarRect,
} from './toolbarPositioning';
import {
    getViewportHeight,
    getViewportWidth,
    resolveViewportBounds,
    type ViewportBounds,
} from '../shared/editorViewport';

/** Everything resolved once per `autoUpdate` registration and reused by every reposition. */
interface PositioningContext {
    /** The widget's `<table>`; the toolbar centres on it rather than on the full-width widget. */
    tableElement: HTMLElement;
    /** The widget root: it clips the table horizontally, and owns the vertical bounds. */
    widgetElement: HTMLElement;
    scrollDOM: HTMLElement;
    doc: Document;
    viewWindow: Window;
    /** Desktop scrolls inside CodeMirror; mobile scrolls the surrounding WebView. */
    isInternalScroll: boolean;
}

/** Measurements taken fresh on every reposition. */
interface ToolbarGeometry {
    toolbarRect: DOMRect;
    /** The box the toolbar anchors to in every placement mode. */
    anchorRect: ToolbarRect;
    viewport: ViewportBounds;
}

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

    update(update: ViewUpdate): void {
        const prevActiveCell = this.currentActiveCell;
        const activeCell = update.state.field(activeCellField);
        this.currentActiveCell = activeCell;

        // Active cell appeared or disappeared
        if (!!prevActiveCell !== !!activeCell) {
            if (activeCell) {
                // Defer until widget DOM is ready (runs in CM's measure cycle after DOM update)
                this.schedulePositionUpdate();
            } else {
                this.cleanupPositioning();
                this.hideToolbar();
            }
            return;
        }

        if (!activeCell) {
            return;
        }

        const movedToDifferentTable = prevActiveCell !== null && prevActiveCell.tableFrom !== activeCell.tableFrom;
        if (movedToDifferentTable || hasRebuiltWidgetDom(update)) {
            // Defer until the new/rebuilt widget DOM is ready
            this.schedulePositionUpdate();
        }

        // Note: autoUpdate handles other cases (scroll/resize)
    }

    destroy(): void {
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
        this.dom.replaceChildren();

        const createIconBtn = (title: string, ariaLabel: string, svg: SVGSVGElement, onClick: () => boolean) => {
            const btn = doc.createElement('button');
            btn.title = title;
            btn.className = 'cm-table-toolbar-btn';
            btn.type = 'button';
            btn.setAttribute('aria-label', ariaLabel);
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (onClick() === false) {
                    this.restoreNestedEditorFocusAfterNoop();
                }
            };
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

        const widgetElement = findTableWidgetElement(this.view, makeTableId(this.currentActiveCell.tableFrom));
        const tableElement = widgetElement && findWidgetTableElement(widgetElement);

        if (!widgetElement || !tableElement) {
            this.cleanupPositioning();
            this.hideToolbar();
            return;
        }

        this.cleanupPositioning();
        this.prepareToolbarForPositioning();

        const scrollDOM = this.view.scrollDOM;
        const doc = getViewDocument(this.view);
        const ctx: PositioningContext = {
            tableElement,
            widgetElement,
            scrollDOM,
            doc,
            viewWindow: getDocumentWindow(doc),
            isInternalScroll: scrollDOM.scrollHeight > scrollDOM.clientHeight + 1,
        };

        if (!ctx.isInternalScroll) {
            // External scroll (mobile) doesn't reliably trigger autoUpdate's ancestor scroll handlers.
            this.cleanupViewportListeners = this.attachViewportListeners();
        }

        // Observing the table (not the widget root) also repositions on horizontal scroll of the
        // widget's overflow container, keeping the toolbar over the visible slice.
        this.cleanupAutoUpdate = autoUpdate(
            tableElement,
            this.dom,
            () => {
                void this.positionToolbar(ctx);
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

    /** Measures the current layout and moves the toolbar, or hides it when it cannot be placed. */
    private async positionToolbar(ctx: PositioningContext) {
        // Ensure element is measurable (display:flex) but hidden (visibility:hidden)
        // before asking Floating UI to compute position.
        this.prepareToolbarForPositioning();

        // Check if reference element is still in the DOM
        if (!ctx.tableElement.isConnected) {
            // Don't cleanup here - just hide and let the next update() call handle cleanup
            this.hideToolbar();
            return;
        }

        const geometry = this.readGeometry(ctx);
        if (isTableOutsideViewport(geometry.anchorRect, geometry.viewport)) {
            this.hideToolbar();
            return;
        }

        const mode = resolveToolbarPlacementMode(geometry.anchorRect, geometry.toolbarRect.height, geometry.viewport);
        const placement =
            mode === 'pinned'
                ? this.resolvePinnedPlacement(ctx, geometry)
                : await this.resolveAnchoredPlacement(ctx, geometry, mode);

        if (!placement) {
            this.hideToolbar();
            return;
        }

        this.showToolbar();
        this.applyPlacement(placement);
    }

    private readGeometry(ctx: PositioningContext): ToolbarGeometry {
        return {
            toolbarRect: this.dom.getBoundingClientRect(),
            anchorRect: resolveToolbarAnchorRect(
                ctx.tableElement.getBoundingClientRect(),
                ctx.widgetElement.getBoundingClientRect()
            ),
            viewport: resolveViewportBounds(ctx.scrollDOM.getBoundingClientRect(), getViewportHeight(ctx.viewWindow)),
        };
    }

    /**
     * Asks Floating UI to anchor the toolbar to the table, retrying below when a top placement
     * would obscure the table. Returns `null` when the toolbar should stay hidden.
     */
    private async resolveAnchoredPlacement(
        ctx: PositioningContext,
        geometry: ToolbarGeometry,
        mode: 'top' | 'bottom'
    ): Promise<ToolbarPlacement | null> {
        const anchor = createVirtualAnchor(ctx.tableElement, geometry.anchorRect);
        const middleware = createPositioningMiddleware();
        const result = await computePosition(anchor, this.dom, { placement: mode, middleware });

        if (result.middlewareData.hide?.referenceHidden) {
            return null;
        }

        // Avoid rendering if we somehow produced a non-finite position.
        if (!isFinitePoint(result)) {
            return null;
        }

        if (isObscuringTopPlacement(result.placement, result.y)) {
            const fallback = await computePosition(anchor, this.dom, {
                placement: 'bottom',
                middleware,
            });
            if (!fallback.middlewareData.hide?.referenceHidden) {
                return { x: fallback.x, y: fallback.y, strategy: 'absolute' };
            }
        }

        return { x: result.x, y: result.y, strategy: 'absolute' };
    }

    /** Pinned mode: toolbar sticks to the viewport edge when the table top/bottom is out of view. */
    private resolvePinnedPlacement(ctx: PositioningContext, geometry: ToolbarGeometry): ToolbarPlacement | null {
        const { anchorRect, toolbarRect, viewport } = geometry;
        const pinAbove = shouldPinAbove(anchorRect, viewport);

        const placement = ctx.isInternalScroll
            ? computePinnedAbsolutePlacement({
                  anchorRect,
                  toolbarRect,
                  viewport,
                  viewRect: this.view.dom.getBoundingClientRect(),
                  offsetParentTop: ((this.dom.offsetParent ?? ctx.doc.body) as HTMLElement).getBoundingClientRect().top,
                  pinAbove,
              })
            : computePinnedFixedPlacement({
                  anchorRect,
                  toolbarRect,
                  viewport,
                  viewportWidth: getViewportWidth(ctx.viewWindow),
                  pinAbove,
              });

        // Avoid rendering if we somehow produced a non-finite position.
        return isFinitePoint(placement) ? placement : null;
    }

    private applyPlacement(placement: ToolbarPlacement) {
        Object.assign(this.dom.style, {
            position: placement.strategy,
            left: `${placement.x}px`,
            top: `${placement.y}px`,
        });
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

/**
 * Anchors Floating UI to the table's visible slice rather than to an element rect. `contextElement`
 * keeps Floating UI's clipping-boundary and offset-parent resolution behaving as it would for a
 * real element reference, so `shift`/`hide` still respect the widget's overflow container.
 */
function createVirtualAnchor(contextElement: HTMLElement, rect: ToolbarRect): VirtualElement {
    const { top, bottom, left, width, height } = rect;

    return {
        contextElement,
        getBoundingClientRect: () => ({ x: left, y: top, top, bottom, left, right: left + width, width, height }),
    };
}

function createPositioningMiddleware(): Middleware[] {
    return [offset(TOOLBAR_OFFSET_PX), shift({ padding: TOOLBAR_VIEWPORT_PADDING_PX }), hide()];
}

/**
 * Conditions that usually imply the widget DOM was replaced/rebuilt:
 * 1. rebuildTableWidgetsEffect (explicit structural edit)
 * 2. Doc changes that are NOT sync (e.g. Undo/Redo, external edits).
 *    Non-sync changes cause `tableDecorationField` to rebuild decorations,
 *    which leads to CodeMirror replacing the widget DOM if content changed.
 */
function hasRebuiltWidgetDom(update: ViewUpdate): boolean {
    const hasRebuildEffect = update.transactions.some((tr) => tr.effects.some((e) => e.is(rebuildTableWidgetsEffect)));
    const isNonSyncDocChange = update.transactions.some((tr) => tr.docChanged && !tr.annotation(syncAnnotation));

    return hasRebuildEffect || isNonSyncDocChange;
}

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
    '.cm-table-toolbar-btn:active': {
        backgroundColor: 'var(--rt-toolbar-hover-bg)',
        borderColor: 'var(--rt-border-color)',
    },
    '@media (hover: hover) and (pointer: fine)': {
        '.cm-table-toolbar-btn:hover': {
            backgroundColor: 'var(--rt-toolbar-hover-bg)',
            borderColor: 'var(--rt-border-color)',
        },
    },
    '.cm-table-toolbar-separator': {
        width: '1px',
        height: '18px',
        backgroundColor: 'var(--rt-border-color)',
        margin: '0 4px',
    },
});
