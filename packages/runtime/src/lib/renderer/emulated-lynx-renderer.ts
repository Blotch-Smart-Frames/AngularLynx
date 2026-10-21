import type { LynxDocumentBase } from '../lynx-document';
import type { BaseLynxElement } from '../lynx-element';
import { LynxRenderer } from './renderer';

/**
 * Angular creates one EmulatedLynxRenderer per component type (keyed by
 * RendererType2.id). This renderer is used when ViewEncapsulation.Emulated
 * is active (the default) and marks elements so the component's scoped CSS
 * matches only them.
 *
 * On the web, Angular's EmulatedEncapsulationDomRenderer2 gives every element
 * the component creates a `_ngcontent-<id>` attribute, and each host element a
 * `_nghost-<id>` attribute, and the compiler scopes the component's selectors
 * with them. Lynx's CSS engine can't match attribute selectors, so the build
 * plugin turns them into class selectors (toLynxScopedCss in the plugin's
 * component-styles.ts), and this renderer adds classes instead. The plugin
 * sets ɵcmp.id, which is `id` here, to the scope ID the CSS was compiled with.
 */
export class EmulatedLynxRenderer extends LynxRenderer {
  readonly #contentClass: string;
  readonly #hostClass: string;

  constructor(document: LynxDocumentBase, componentId: string) {
    super(document);
    this.#contentClass = `_ngcontent-${componentId}`;
    this.#hostClass = `_nghost-${componentId}`;
  }

  /**
   * Marks a host element of this component type, for `:host` selectors.
   * LynxRendererFactory2 calls it for each component instance, as Angular's
   * DomRendererFactory2 does.
   */
  applyToHost(element: BaseLynxElement): void {
    element.addScopeClass(this.#hostClass);
  }

  override createElement(
    name: string,
    namespace?: string | null,
  ): BaseLynxElement {
    const element = super.createElement(name, namespace);
    element.addScopeClass(this.#contentClass);
    return element;
  }

  override selectRootElement() {
    const el = super.selectRootElement();
    this.applyToHost(el);
    return el;
  }
}
