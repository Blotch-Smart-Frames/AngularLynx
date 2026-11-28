/**
 * `<apple-sign-in-button>` under the testing library, on the real renderer.
 * While the fake Sign in with Apple module is there, as in an iOS app with
 * `signInWithApple`, it's iOS's native element; without it, as on Android
 * and the web, the runtime draws the button itself.
 */

import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it, vi } from 'vitest';
import { answerAppleSignInButtonOnMainThread } from './apple-sign-in.js';
import {
  fireEvent,
  render,
  screen,
  setAppleSignInAvailable,
  waitForUpdate,
} from './index.js';

@Component({
  selector: 'apple-button-screen',
  imports: [LYNX_ELEMENTS],
  template: `
    @if (shown()) {
      <apple-sign-in-button
        class="h-12 w-full"
        [type]="type()"
        [button-style]="buttonStyle()"
        [corner-radius]="radius()"
        (bindtap)="taps.set(taps() + 1)"
      />
    }
    <text>taps: {{ taps() }}</text>
  `,
})
class AppleButtonScreen {
  readonly shown = signal(true);
  readonly type = signal<'signIn' | 'continue' | 'signUp'>('signIn');
  readonly buttonStyle = signal<'black' | 'white' | 'whiteOutline'>('black');
  readonly radius = signal(8);
  readonly taps = signal(0);
}

/**
 * The drawn button's face, which holds its look (see the runtime's creator).
 */
const faceOf = (button: Element): HTMLElement =>
  button.firstElementChild as HTMLElement;

describe('<apple-sign-in-button>', () => {
  it('is the native element where the shell has it, with the attributes iOS reads', async () => {
    const { componentRef } = await render(AppleButtonScreen);
    const button = document.querySelector('apple-sign-in-button');
    expect(button).not.toBeNull();
    expect(button!.getAttribute('type')).toBe('signIn');
    expect(button!.getAttribute('button-style')).toBe('black');
    expect(button!.getAttribute('corner-radius')).toBe('8');
    // iOS draws it: the runtime puts nothing inside.
    expect(button!.children).toHaveLength(0);

    componentRef.instance.type.set('continue');
    componentRef.instance.buttonStyle.set('whiteOutline');
    await waitForUpdate();
    expect(button!.getAttribute('type')).toBe('continue');
    expect(button!.getAttribute('button-style')).toBe('whiteOutline');

    fireEvent.tap(button!);
    await waitForUpdate();
    expect(screen.getByText('taps: 1')).toBeInTheDocument();
  });

  it('is drawn by the runtime where there is no native button, as on Android and the web', async () => {
    setAppleSignInAvailable(false);
    await render(AppleButtonScreen);
    expect(document.querySelector('apple-sign-in-button')).toBeNull();

    const title = screen.getByText('Sign in with Apple');
    const face = title.parentElement!;
    expect(face.getAttribute('accessibility-label')).toBe('Sign in with Apple');
    expect(face.getAttribute('accessibility-traits')).toBe('button');
    expect(face.getAttribute('style')).toContain('background-color:#000000');
    expect(face.getAttribute('style')).toContain('border-radius:8px');
    expect(title.getAttribute('style')).toContain('color:#ffffff');
    // The logo beside it, in the title's color.
    expect(face.querySelector('svg')?.getAttribute('content')).toContain(
      'fill="#ffffff"',
    );
  });

  it('draws the title and colors the attributes ask for, as they change', async () => {
    setAppleSignInAvailable(false);
    const { componentRef } = await render(AppleButtonScreen);

    componentRef.instance.type.set('signUp');
    componentRef.instance.buttonStyle.set('whiteOutline');
    componentRef.instance.radius.set(22);
    await waitForUpdate();

    const title = screen.getByText('Sign up with Apple');
    const face = title.parentElement!;
    const style = face.getAttribute('style');
    expect(style).toContain('background-color:#ffffff');
    expect(style).toContain('border-color:#000000');
    expect(style).toContain('border-radius:22px');
    expect(title.getAttribute('style')).toContain('color:#000000');
    expect(face.getAttribute('accessibility-label')).toBe('Sign up with Apple');

    componentRef.instance.type.set('continue');
    componentRef.instance.buttonStyle.set('white');
    await waitForUpdate();
    expect(screen.getByText('Continue with Apple')).toBeInTheDocument();
    expect(
      faceOf(
        screen.getByText('Continue with Apple').parentElement!.parentElement!,
      ).getAttribute('style'),
    ).not.toContain('border-color');
  });

  it('taps through the drawn button', async () => {
    setAppleSignInAvailable(false);
    await render(AppleButtonScreen);
    fireEvent.tap(screen.getByText('Sign in with Apple'));
    await waitForUpdate();
    expect(screen.getByText('taps: 1')).toBeInTheDocument();
  });

  it('draws the button again when it comes back', async () => {
    setAppleSignInAvailable(false);
    const { componentRef } = await render(AppleButtonScreen);
    componentRef.instance.type.set('signUp');
    await waitForUpdate();
    componentRef.instance.shown.set(false);
    await waitForUpdate();
    expect(screen.queryByText('Sign up with Apple')).toBeNull();

    componentRef.instance.shown.set(true);
    await waitForUpdate();
    expect(screen.getByText('Sign up with Apple')).toBeInTheDocument();
  });
});

describe('answerAppleSignInButtonOnMainThread', () => {
  type Module = { invoke: (method: string) => unknown } | undefined;
  const install = (other?: (name: string) => unknown) => {
    const globals: { lynx?: { module?: (name: string) => unknown } } = {
      lynx: other ? { module: other } : {},
    };
    answerAppleSignInButtonOnMainThread(globals);
    return (name: string) => globals.lynx!.module!(name) as Module;
  };

  it('leaves a thread without lynx alone', () => {
    const globals = {};
    answerAppleSignInButtonOnMainThread(globals);
    expect(globals).toEqual({});
  });

  it('answers only button, and leaves the other modules to what was there', () => {
    const webgl = { invoke: () => 'gl' };
    const other = vi.fn((name: string) =>
      name === 'AngularLynxWebGL' ? webgl : undefined,
    );
    const module = install(other);
    expect(module('AngularLynxWebGL')).toBe(webgl);
    expect(module('AngularLynxAppleSignIn')!.invoke('signIn')).toBeUndefined();
    expect(module('AngularLynxAppleSignIn')!.invoke('button')).toEqual({
      available: true,
    });
    expect(install()('AngularLynxWebGL')).toBeUndefined();
  });

  it('answers nothing without the fake module', () => {
    const env = (globalThis as any).lynxTestingEnv.backgroundThread.globalThis;
    const modules = env.NativeModules;
    env.NativeModules = {};
    try {
      expect(
        install()('AngularLynxAppleSignIn')!.invoke('button'),
      ).toBeUndefined();
    } finally {
      env.NativeModules = modules;
    }
  });
});
