import {
  ApplicationRef,
  type ComponentRef,
  type EmbeddedViewRef,
  EnvironmentInjector,
  Injectable,
  type TemplateRef,
  type Type,
  createComponent,
  inject,
} from '@angular/core';
import type { BaseLynxElement } from '../lynx-element';
import { LYNX_DOCUMENT } from '../renderer/token';

/**
 * Configuration for creating a portal overlay.
 */
export type PortalConfig = {
  /**
   * Overlay z-level (1–4). Higher levels render above lower ones.
   */
  level?: number;
  /**
   * Custom injector for the component's dependency injection context.
   */
  injector?: EnvironmentInjector;
  /**
   * Initial input values to set on the component after creation.
   */
  inputs?: Record<string, unknown>;
};

/**
 * Handle for managing a portal instance created by {@link LynxPortal}.
 *
 * Call {@link destroy} to tear down the overlay and its content.
 */
export class PortalRef<T> {
  readonly #overlay: BaseLynxElement;
  readonly #appRef: ApplicationRef;
  readonly #componentRef: ComponentRef<T> | null;
  readonly #viewRef: EmbeddedViewRef<unknown> | null;

  /**
   * @internal
   */
  constructor(
    overlay: BaseLynxElement,
    appRef: ApplicationRef,
    componentRef: ComponentRef<T> | null,
    viewRef: EmbeddedViewRef<unknown> | null,
  ) {
    this.#overlay = overlay;
    this.#appRef = appRef;
    this.#componentRef = componentRef;
    this.#viewRef = viewRef;
  }

  /**
   * The component instance. `null` for template portals.
   */
  get instance(): T | null {
    return this.#componentRef?.instance ?? null;
  }

  /**
   * Sets a component input. Only works for component portals.
   */
  setInput(name: string, value: unknown): void {
    this.#componentRef?.setInput(name, value);
  }

  /**
   * Tears down the portal: destroys the component/template view,
   * detaches from change detection, and removes the native overlay element.
   */
  destroy(): void {
    if (this.#componentRef) {
      this.#appRef.detachView(this.#componentRef.hostView);
      this.#componentRef.destroy();
    }
    if (this.#viewRef) {
      this.#appRef.detachView(this.#viewRef);
      this.#viewRef.destroy();
    }
    this.#overlay.remove();
  }
}

/**
 * Programmatically renders Angular components or templates inside a native
 * Lynx `<overlay>` element — the equivalent of Angular CDK's
 * `Overlay` / `DomPortalOutlet`.
 *
 * For **declarative** overlays, use `<overlay>` directly in your template.
 * This service is for **imperative** cases: modal dialogs, toast notifications,
 * or any content that needs to be created from code rather than a template.
 *
 * @usageNotes
 * ```typescript
 * const portal = inject(LynxPortal);
 *
 * // Open a component in an overlay
 * const ref = portal.open(ConfirmDialogComponent, {
 *   level: 2,
 *   inputs: { title: 'Delete item?' },
 * });
 *
 * // Update inputs later
 * ref.setInput('title', 'Are you sure?');
 *
 * // Tear down when done
 * ref.destroy();
 *
 * // Open a template in an overlay
 * const tplRef = portal.openTemplate(myTemplateRef, { level: 1 });
 * tplRef.destroy();
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxPortal {
  readonly #doc = inject(LYNX_DOCUMENT);
  readonly #appRef = inject(ApplicationRef);
  readonly #envInjector = inject(EnvironmentInjector);

  /**
   * Creates a native `<overlay>` and renders the given component into it.
   *
   * The component participates in Angular change detection and is fully
   * functional (inputs, outputs, dependency injection, lifecycle hooks).
   */
  open<T>(component: Type<T>, config?: PortalConfig): PortalRef<T> {
    const overlay = this.#createOverlay(config);

    const componentRef = createComponent(component, {
      environmentInjector: config?.injector ?? this.#envInjector,
    });

    if (config?.inputs) {
      for (const [key, value] of Object.entries(config.inputs)) {
        componentRef.setInput(key, value);
      }
    }

    this.#appRef.attachView(componentRef.hostView);
    overlay.appendChild(componentRef.location.nativeElement);

    // createRootElement() returns the existing singleton page element, NOT a new
    // one. The overlay must be a direct child of the page so native Lynx renders
    // it as a top-level overlay above all other content.
    const page = this.#doc.createRootElement();
    page.appendChild(overlay);

    return new PortalRef(overlay, this.#appRef, componentRef, null);
  }

  /**
   * Creates a native `<overlay>` and renders the given template into it.
   *
   * Use this when you have a `TemplateRef` (from `@ViewChild` or a
   * template variable) rather than a component class.
   */
  openTemplate<C>(
    template: TemplateRef<C>,
    config?: PortalConfig & { context?: C },
  ): PortalRef<null> {
    const overlay = this.#createOverlay(config);

    const viewRef = template.createEmbeddedView(
      config?.context ?? ({} as C),
      config?.injector ?? this.#envInjector,
    );

    this.#appRef.attachView(viewRef);

    for (const node of viewRef.rootNodes) {
      overlay.appendChild(node);
    }

    // Same singleton page pattern as open() — overlay goes under the root page.
    const page = this.#doc.createRootElement();
    page.appendChild(overlay);

    return new PortalRef(overlay, this.#appRef, null, viewRef);
  }

  #createOverlay(config?: PortalConfig): BaseLynxElement {
    const overlay = this.#doc.createElement('overlay');
    overlay.setAttribute('visible', true);
    if (config?.level != null) {
      overlay.setAttribute('level', config.level);
    }
    return overlay;
  }
}
