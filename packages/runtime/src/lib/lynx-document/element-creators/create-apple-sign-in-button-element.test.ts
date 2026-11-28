import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElementRef } from '../../types/lynx';
import {
  createAppleSignInButtonElement,
  updateAppleSignInButton,
} from './create-apple-sign-in-button-element';

/** A native element, which records what's set on it. */
type FakeRef = {
  tag: string;
  parent?: FakeRef;
  children: FakeRef[];
  attributes: Record<string, unknown>;
  style?: string;
  text?: string;
};

const ref = (tag: string, text?: string): FakeRef => ({
  tag,
  children: [],
  attributes: {},
  ...(text !== undefined && { text }),
});

/**
 * Has `lynx.module(name)` return `module`.
 */
const shellModule = (module: unknown) =>
  vi.stubGlobal('lynx', {
    module: vi.fn((name: string) =>
      name === 'AngularLynxAppleSignIn' ? module : undefined,
    ),
  });

const nativeModule = { invoke: vi.fn(() => ({ available: true })) };

beforeEach(() => {
  vi.stubGlobal('__WEB__', false);
  vi.stubGlobal('lynx', {});
  vi.stubGlobal(
    '__CreateElement',
    vi.fn((tag: string) => ref(tag)),
  );
  vi.stubGlobal(
    '__CreateView',
    vi.fn(() => ref('view')),
  );
  vi.stubGlobal(
    '__CreateText',
    vi.fn(() => ref('text')),
  );
  vi.stubGlobal(
    '__CreateRawText',
    vi.fn((text: string) => ref('raw-text', text)),
  );
  vi.stubGlobal(
    '__AppendElement',
    vi.fn((parent: FakeRef, child: FakeRef) => {
      child.parent = parent;
      parent.children.push(child);
    }),
  );
  vi.stubGlobal(
    '__GetTag',
    vi.fn((element: FakeRef) => element.tag),
  );
  vi.stubGlobal(
    '__FirstElement',
    vi.fn((element: FakeRef) => element.children[0] ?? null),
  );
  vi.stubGlobal(
    '__NextElement',
    vi.fn((element: FakeRef) => {
      const siblings = element.parent?.children ?? [];
      return siblings[siblings.indexOf(element) + 1] ?? null;
    }),
  );
  vi.stubGlobal(
    '__SetAttribute',
    vi.fn((element: FakeRef, name: string, value: unknown) => {
      element.attributes[name] = value;
    }),
  );
  vi.stubGlobal(
    '__SetInlineStyles',
    vi.fn((element: FakeRef, style: string) => {
      element.style = style;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/**
 * The drawn button's parts.
 */
const partsOf = (element: FakeRef) => {
  const face = element.children[0];
  const [logo, title] = face.children;
  return { face, logo, title, titleText: title.children[0] };
};

const draw = (attributes: Record<string, unknown>) => {
  const element = createAppleSignInButtonElement(1) as unknown as FakeRef;
  updateAppleSignInButton(
    element as unknown as ElementRef,
    new Map(Object.entries(attributes)),
  );
  return partsOf(element);
};

describe('createAppleSignInButtonElement', () => {
  it('makes iOS’s button where the shell’s module says it has one', () => {
    shellModule(nativeModule);
    const element = createAppleSignInButtonElement(1) as unknown as FakeRef;
    expect(element.tag).toBe('apple-sign-in-button');
    expect(element.children).toHaveLength(0);
    expect(nativeModule.invoke).toHaveBeenCalledWith('button');
    // iOS reads the attributes itself.
    updateAppleSignInButton(
      element as unknown as ElementRef,
      new Map([['type', 'continue']]),
    );
    expect(__SetInlineStyles).not.toHaveBeenCalled();
  });

  it.each([
    ['a host without lynx.module, such as an old Lynx', undefined],
    ['a host without the module', null],
    ['a module whose calls answer nothing', { invoke: () => undefined }],
    ['a module without invoke', {}],
    [
      'a module that throws',
      {
        invoke: () => {
          throw new Error('no such method');
        },
      },
    ],
  ])('draws the button on %s', (_host, module) => {
    if (module !== undefined) shellModule(module);
    const element = createAppleSignInButtonElement(1) as unknown as FakeRef;
    expect(element.tag).toBe('view');
    const { face, logo, title, titleText } = partsOf(element);
    expect(logo.tag).toBe('svg');
    expect(title.tag).toBe('text');
    expect(titleText.attributes['text']).toBe('Sign in with Apple');
    expect(face.attributes).toMatchObject({
      'accessibility-element': true,
      'accessibility-traits': 'button',
      'accessibility-label': 'Sign in with Apple',
    });
    expect(face.style).toContain('background-color:#000000');
    expect(face.style).toContain('border-radius:6px');
    expect(String(logo.attributes['content'])).toContain('fill="#ffffff"');
  });

  it('draws the button when lynx.module itself throws', () => {
    vi.stubGlobal('lynx', {
      module: () => {
        throw new Error('not on this thread');
      },
    });
    expect((createAppleSignInButtonElement(1) as unknown as FakeRef).tag).toBe(
      'view',
    );
  });

  it('draws the button in the web preview, which has no native one', () => {
    vi.stubGlobal('__WEB__', true);
    shellModule(nativeModule);
    expect((createAppleSignInButtonElement(1) as unknown as FakeRef).tag).toBe(
      'view',
    );
    expect(nativeModule.invoke).not.toHaveBeenCalled();
  });
});

describe('updateAppleSignInButton', () => {
  it('draws each type’s title', () => {
    expect(draw({ type: 'continue' }).titleText.attributes['text']).toBe(
      'Continue with Apple',
    );
    expect(draw({ type: 'signUp' }).titleText.attributes['text']).toBe(
      'Sign up with Apple',
    );
    // A type Apple has no title for, or an inherited name, signs in.
    expect(draw({ type: 'subscribe' }).titleText.attributes['text']).toBe(
      'Sign in with Apple',
    );
    expect(draw({ type: 'toString' }).titleText.attributes['text']).toBe(
      'Sign in with Apple',
    );
  });

  it('draws each style’s colors', () => {
    const white = draw({ 'button-style': 'white' });
    expect(white.face.style).toContain('background-color:#ffffff');
    expect(white.face.style).not.toContain('border-width');
    expect(white.title.style).toContain('color:#000000');

    const outline = draw({ 'button-style': 'whiteOutline' });
    expect(outline.face.style).toContain(
      'border-width:1px;border-style:solid;border-color:#000000;',
    );
    expect(String(outline.logo.attributes['content'])).toContain(
      'fill="#000000"',
    );

    expect(draw({ 'button-style': 42 }).face.style).toContain(
      'background-color:#000000',
    );
  });

  it('takes the corner radius as a number or a string, and keeps the default for anything else', () => {
    expect(draw({ 'corner-radius': 12 }).face.style).toContain(
      'border-radius:12px',
    );
    expect(draw({ 'corner-radius': '0' }).face.style).toContain(
      'border-radius:0px',
    );
    expect(draw({ 'corner-radius': -4 }).face.style).toContain(
      'border-radius:6px',
    );
    expect(draw({ 'corner-radius': 'round' }).face.style).toContain(
      'border-radius:6px',
    );
  });

  it('leaves an element it didn’t draw alone', () => {
    updateAppleSignInButton(ref('view') as unknown as ElementRef, null);
    // A view with a face but not the rest of the parts.
    const partial = ref('view');
    partial.children.push(ref('view'));
    updateAppleSignInButton(partial as unknown as ElementRef, null);
    expect(__SetInlineStyles).not.toHaveBeenCalled();
  });
});
