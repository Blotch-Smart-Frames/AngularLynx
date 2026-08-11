import type { LynxDocumentBase } from '../lynx-document';
import { LynxRenderer } from './renderer';

/**
 * Angular creates one EmulatedLynxRenderer per component type (keyed by
 * RendererType2.id). This renderer is used when ViewEncapsulation.Emulated
 * is active (the default) and handles adding scope classes for CSS isolation.
 *
 * In a browser, Angular's EmulatedEncapsulationDomRenderer2 adds _ngcontent-xxx
 * attributes to every element. In Lynx, the template plugin handles per-component
 * CSS scoping natively, so we only need the _nghost class on the host element
 * (for :host selectors). Child elements get no scope classes at all.
 */
export class EmulatedLynxRenderer extends LynxRenderer {
  #componentScopeId: string;

  constructor(document: LynxDocumentBase, componentId: string) {
    super(document);
    this.#componentScopeId = componentId;
  }

  /**
   * Note: we no longer add scope classes to child elements. The Lynx template
   * embeds the component scope ID separately from element class lists, so plain
   * class selectors in CSS are matched by the native CSS engine without needing
   * a conjunction scope class on every element.
   */
  override selectRootElement() {
    const el = super.selectRootElement();
    // Keep scope class on the host element for potential :host CSS rules.
    el.addClass(`_nghost-${this.#componentScopeId}`);
    return el;
  }
}
