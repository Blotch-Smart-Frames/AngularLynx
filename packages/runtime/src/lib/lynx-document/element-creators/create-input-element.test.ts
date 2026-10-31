import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stackWebTextarea } from '../web-textarea';
import { createInputElement } from './create-input-element';

vi.mock('../web-textarea', () => ({ stackWebTextarea: vi.fn() }));

const ref = { tag: 'field' };

beforeEach(() => {
  vi.stubGlobal(
    '__CreateElement',
    vi.fn(() => ref),
  );
  vi.stubGlobal('__WEB__', true);
  vi.stubGlobal('__MAIN_THREAD__', true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('createInputElement', () => {
  it('creates the native field', () => {
    expect(createInputElement('input', 3)).toBe(ref);
    expect(__CreateElement).toHaveBeenCalledWith('input', 3);
  });

  it("gives a web textarea an input's z-index handling", () => {
    expect(createInputElement('textarea', 3)).toBe(ref);
    expect(stackWebTextarea).toHaveBeenCalledWith(ref);
  });

  it('leaves inputs, which web-elements already handles, alone', () => {
    createInputElement('input', 3);
    expect(stackWebTextarea).not.toHaveBeenCalled();
  });

  it('leaves a native textarea to the platform', () => {
    vi.stubGlobal('__WEB__', false);
    createInputElement('textarea', 3);
    expect(stackWebTextarea).not.toHaveBeenCalled();
  });

  it("doesn't touch the background thread's stand-in elements", () => {
    vi.stubGlobal('__MAIN_THREAD__', false);
    createInputElement('textarea', 3);
    expect(stackWebTextarea).not.toHaveBeenCalled();
  });
});
