import { describe, expect, it, vi } from 'vitest';
import { InMemoryDocument } from '../testing/in-memory-document';
import { InMemoryElement } from '../testing/in-memory-element';
import { EmulatedLynxRenderer } from './emulated-lynx-renderer';

describe('EmulatedLynxRenderer', () => {
  const createRenderer = (componentId: string) => {
    const doc = new InMemoryDocument();
    return new EmulatedLynxRenderer(doc, componentId);
  };

  it('createElement adds the _ngcontent scope class', () => {
    // The plugin compiles `.title` in this component's styles to
    // `.title._ngcontent-<id>`, so every element its template creates needs it.
    const spy = vi.spyOn(InMemoryElement.prototype, 'addScopeClass');
    const renderer = createRenderer('abc123');
    renderer.createElement('view');

    expect(spy).toHaveBeenCalledWith('_ngcontent-abc123');
    expect(spy).not.toHaveBeenCalledWith('_nghost-abc123');
    spy.mockRestore();
  });

  it('applyToHost adds the _nghost scope class, for :host selectors', () => {
    const renderer = createRenderer('abc123');
    const host = new InMemoryDocument().createElement('view');
    const spy = vi.spyOn(host, 'addScopeClass');

    renderer.applyToHost(host);

    expect(spy).toHaveBeenCalledWith('_nghost-abc123');
  });

  it('selectRootElement adds _nghost class', () => {
    const spy = vi.spyOn(InMemoryElement.prototype, 'addClass');
    const renderer = createRenderer('abc123');
    renderer.selectRootElement();

    expect(spy).toHaveBeenCalledWith('_nghost-abc123');
    spy.mockRestore();
  });

  it('different components get different host classes', () => {
    const spy1 = vi.spyOn(InMemoryElement.prototype, 'addClass');
    const renderer1 = createRenderer('comp1');
    renderer1.selectRootElement();
    expect(spy1).toHaveBeenCalledWith('_nghost-comp1');
    expect(spy1).not.toHaveBeenCalledWith('_nghost-comp2');
    spy1.mockRestore();

    const spy2 = vi.spyOn(InMemoryElement.prototype, 'addClass');
    const renderer2 = createRenderer('comp2');
    renderer2.selectRootElement();
    expect(spy2).toHaveBeenCalledWith('_nghost-comp2');
    expect(spy2).not.toHaveBeenCalledWith('_nghost-comp1');
    spy2.mockRestore();
  });

  it('createComment does not add any classes', () => {
    const spy = vi.spyOn(InMemoryElement.prototype, 'addClass');
    const renderer = createRenderer('abc123');
    renderer.createComment('test');

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('createText does not add any classes', () => {
    const spy = vi.spyOn(InMemoryElement.prototype, 'addClass');
    const renderer = createRenderer('abc123');
    renderer.createText('hello');

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
