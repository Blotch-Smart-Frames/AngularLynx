import { describe, expect, it, vi } from 'vitest';
import { LynxBackgroundDocument } from '../lynx-document';
import { LynxBackgroundElement } from '../lynx-element';
import { EmulatedLynxRenderer } from './emulated-lynx-renderer';

describe('EmulatedLynxRenderer', () => {
  const createRenderer = (componentId: string) => {
    const doc = new LynxBackgroundDocument();
    return new EmulatedLynxRenderer(doc, componentId);
  };

  it('createElement does not add any scope class', () => {
    const spy = vi.spyOn(LynxBackgroundElement.prototype, 'addClass');
    const renderer = createRenderer('abc123');
    renderer.createElement('view');

    expect(spy).not.toHaveBeenCalledWith('_ngscope-abc123');
    expect(spy).not.toHaveBeenCalledWith('_nghost-abc123');
    spy.mockRestore();
  });

  it('selectRootElement adds _nghost class', () => {
    const spy = vi.spyOn(LynxBackgroundElement.prototype, 'addClass');
    const renderer = createRenderer('abc123');
    renderer.selectRootElement();

    expect(spy).toHaveBeenCalledWith('_nghost-abc123');
    spy.mockRestore();
  });

  it('different components get different host classes', () => {
    const spy1 = vi.spyOn(LynxBackgroundElement.prototype, 'addClass');
    const renderer1 = createRenderer('comp1');
    renderer1.selectRootElement();
    expect(spy1).toHaveBeenCalledWith('_nghost-comp1');
    expect(spy1).not.toHaveBeenCalledWith('_nghost-comp2');
    spy1.mockRestore();

    const spy2 = vi.spyOn(LynxBackgroundElement.prototype, 'addClass');
    const renderer2 = createRenderer('comp2');
    renderer2.selectRootElement();
    expect(spy2).toHaveBeenCalledWith('_nghost-comp2');
    expect(spy2).not.toHaveBeenCalledWith('_nghost-comp1');
    spy2.mockRestore();
  });

  it('createComment does not add any classes', () => {
    const spy = vi.spyOn(LynxBackgroundElement.prototype, 'addClass');
    const renderer = createRenderer('abc123');
    renderer.createComment('test');

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('createText does not add any classes', () => {
    const spy = vi.spyOn(LynxBackgroundElement.prototype, 'addClass');
    const renderer = createRenderer('abc123');
    renderer.createText('hello');

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
