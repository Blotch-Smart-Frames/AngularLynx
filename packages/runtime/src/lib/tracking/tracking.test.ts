// @vitest-environment jsdom
import '@angular/compiler';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LynxAppState } from '../app-state/app-state';
import { LynxTracking } from './tracking';

type Done = (result: object) => void;

/**
 * The service from a root injector whose app state a test can change, as the
 * host's appState prop does.
 */
const create = () => {
  const active = signal(true);
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: LynxAppState, useValue: { active } },
    ],
  });
  return { tracking: TestBed.inject(LynxTracking), active };
};

/**
 * Stands in for the shells' AngularLynxTracking module, as the background
 * thread sees it. Unit tests run as the background thread, so the service
 * calls it directly. Each method keeps its callbacks, for `answer` to call.
 */
const stubModule = () => {
  const pending: Record<'status' | 'request', Done[]> = {
    status: [],
    request: [],
  };
  const status = vi.fn((done: Done) => pending.status.push(done));
  const request = vi.fn((done: Done) => pending.request.push(done));
  vi.stubGlobal('NativeModules', { AngularLynxTracking: { status, request } });
  return {
    status,
    request,
    answer: (method: 'status' | 'request', result: object) =>
      pending[method].shift()?.(result),
  };
};

/**
 * Lets the module's answer reach the service through its promises.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('LynxTracking', () => {
  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  it('reads the status when it is created', async () => {
    const module = stubModule();
    const { tracking } = create();
    // Until the module answers.
    expect(tracking.status()).toBe('notDetermined');
    expect(module.status).toHaveBeenCalledOnce();
    module.answer('status', { status: 'denied' });
    await settle();
    expect(tracking.status()).toBe('denied');
  });

  it('shows the prompt, and resolves with the answer, which the status then holds', async () => {
    const module = stubModule();
    const { tracking } = create();
    module.answer('status', { status: 'notDetermined' });
    const answer = tracking.requestPermission();
    await settle();
    expect(module.request).toHaveBeenCalledOnce();
    module.answer('request', { status: 'authorized' });
    await expect(answer).resolves.toBe('authorized');
    expect(tracking.status()).toBe('authorized');
  });

  it("keeps the prompt's answer over a status read the prompt overtook", async () => {
    const module = stubModule();
    const { tracking } = create();
    const answer = tracking.requestPermission();
    await settle();
    module.answer('request', { status: 'authorized' });
    await answer;
    module.answer('status', { status: 'notDetermined' });
    await settle();
    expect(tracking.status()).toBe('authorized');
  });

  it('reads it again when the app comes back to the foreground', async () => {
    const module = stubModule();
    const { tracking, active } = create();
    module.answer('status', { status: 'authorized' });
    await settle();
    TestBed.tick();
    expect(module.status).toHaveBeenCalledOnce();

    active.set(false);
    TestBed.tick();
    expect(module.status).toHaveBeenCalledOnce();

    active.set(true);
    TestBed.tick();
    expect(module.status).toHaveBeenCalledTimes(2);
    module.answer('status', { status: 'denied' });
    await settle();
    expect(tracking.status()).toBe('denied');
  });

  it("reads a status it doesn't know as denied, so the app doesn't track", async () => {
    const module = stubModule();
    const { tracking } = create();
    module.answer('status', { status: 'provisional' });
    await settle();
    expect(tracking.status()).toBe('denied');
  });

  // Lynx Explorer, the web preview and an app built without
  // permissions.tracking.
  it('is unsupported without the native module, and never rejects', async () => {
    vi.stubGlobal('NativeModules', {});
    const { tracking } = create();
    await expect(tracking.requestPermission()).resolves.toBe('unsupported');
    expect(tracking.status()).toBe('unsupported');
  });
});
