/**
 * LynxNfc in rendered specs (issue #921).
 *
 * There's no NFC reader in a spec, so the setup file gives the environment
 * an NFC module whose tags come near the phone when the spec calls
 * tapNfcTag(). The answers go through the background thread, as the shells'
 * do.
 */

import { Component, inject, signal } from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxNfc,
  NfcError,
  type NfcScan,
} from '@blotch/angular-lynx';
import { afterEach, describe, expect, it } from 'vitest';
import {
  failNfcSession,
  fireEvent,
  nfcSession,
  nfcWrites,
  render,
  screen,
  setAppState,
  setNfcState,
  tapNfcTag,
  waitForUpdate,
} from './index.js';

/**
 * Waits until the relay's promises have settled and the view has caught up.
 */
const settle = async () => {
  for (let i = 0; i < 5; i++) await waitForUpdate();
};

@Component({
  selector: 'membership-card',
  imports: [LYNX_ELEMENTS],
  template: `
    <text>State: {{ nfc.state() }}</text>
    <view (bindtap)="read()"><text>Read card</text></view>
    <view (bindtap)="write()"><text>Write card</text></view>
    <view (bindtap)="scan()"><text>Scan cards</text></view>
    <view (bindtap)="stop()"><text>Stop</text></view>
    <text>{{ status() }}</text>
  `,
})
class MembershipCard {
  readonly nfc = inject(LynxNfc);
  readonly status = signal('Idle');
  #scan: NfcScan | undefined;
  readonly #seen: string[] = [];

  async read(): Promise<void> {
    this.status.set('Reading');
    try {
      const tag = await this.nfc.read({ alertMessage: 'Hold your card' });
      const record = tag.records[0];
      this.status.set(
        record?.type === 'url' ? `Member at ${record.value}` : 'Empty card',
      );
    } catch (error) {
      this.status.set(`Error: ${(error as NfcError).code}`);
    }
  }

  async write(): Promise<void> {
    try {
      await this.nfc.write([{ type: 'text', value: 'Member 42' }]);
      this.status.set('Written');
    } catch (error) {
      this.status.set(`Error: ${(error as NfcError).code}`);
    }
  }

  async scan(): Promise<void> {
    this.#scan = await this.nfc.scan({}, (tag) => {
      this.#seen.push(tag.id ?? '?');
      this.status.set(`Seen ${this.#seen.join(', ')}`);
    });
  }

  async stop(): Promise<void> {
    await this.#scan?.stop();
    this.status.set(`Stopped after ${this.#seen.length}`);
  }
}

const tap = async (label: string) => {
  fireEvent.tap(screen.getByText(label));
  await settle();
};

describe('tapNfcTag', () => {
  it("resolves the open read with the tag's records", async () => {
    await render(MembershipCard);
    await settle();
    expect(screen.getByText('State: ready')).toBeInTheDocument();

    await tap('Read card');
    expect(nfcSession()).toEqual({
      alertMessage: 'Hold your card',
      multiple: false,
      writing: false,
    });
    tapNfcTag({
      records: [{ type: 'url', value: 'https://example.com/m/42' }],
    });
    await settle();
    expect(
      screen.getByText('Member at https://example.com/m/42'),
    ).toBeInTheDocument();
    expect(nfcSession()).toBeUndefined();
  });

  it('keeps a tag tapped before the read opens for when it does', async () => {
    await render(MembershipCard);
    tapNfcTag();
    await tap('Read card');
    expect(screen.getByText('Empty card')).toBeInTheDocument();
  });

  it('rejects a read of a tag without NDEF', async () => {
    await render(MembershipCard);
    await tap('Read card');
    tapNfcTag({ ndef: false });
    await settle();
    expect(screen.getByText('Error: tagNotNdef')).toBeInTheDocument();
  });

  it("writes the app's records, which nfcWrites() lists", async () => {
    await render(MembershipCard);
    await tap('Write card');
    expect(nfcSession()).toMatchObject({ writing: true });
    tapNfcTag({ id: '04a1' });
    await settle();
    expect(screen.getByText('Written')).toBeInTheDocument();
    expect(nfcWrites()).toEqual([
      [{ type: 'text', value: 'Member 42', lang: 'en' }],
    ]);
  });

  it("refuses to write to a locked tag, or one the records don't fit", async () => {
    await render(MembershipCard);
    await tap('Write card');
    tapNfcTag({ writable: false });
    await settle();
    expect(screen.getByText('Error: readOnly')).toBeInTheDocument();

    await tap('Write card');
    tapNfcTag({ capacity: 4 });
    await settle();
    expect(screen.getByText('Error: tooLarge')).toBeInTheDocument();
    expect(nfcWrites()).toEqual([]);
  });

  it('calls a scan back with each tag, and skips one it cannot read', async () => {
    await render(MembershipCard);
    await tap('Scan cards');
    expect(nfcSession()).toMatchObject({ multiple: true });
    tapNfcTag({ id: 'a1' });
    tapNfcTag({ ndef: false });
    tapNfcTag({ id: 'b2' });
    await settle();
    expect(screen.getByText('Seen a1, b2')).toBeInTheDocument();
    await tap('Stop');
    expect(screen.getByText('Stopped after 2')).toBeInTheDocument();
    expect(nfcSession()).toBeUndefined();
  });

  it('counts a big record by its four-byte length', async () => {
    await render(NfcHolder);
    const nfc = TestNfc.get();
    const write = nfc.write([
      { type: 'mime', mediaType: 'a/b', data: new Uint8Array(300) },
    ]);
    // 1 header + 1 type length + 4 payload length + 3 type + 300 payload.
    tapNfcTag({ capacity: 308 });
    await expect(write).rejects.toMatchObject({ code: 'tooLarge' });
    const fits = nfc.write([
      { type: 'mime', mediaType: 'a/b', data: new Uint8Array(300) },
    ]);
    tapNfcTag({ capacity: 309 });
    await expect(fits).resolves.toMatchObject({ capacity: 309 });
  });
});

/** The app's LynxNfc, for specs that call it without a component. */
const TestNfc = {
  instance: undefined as LynxNfc | undefined,
  get(): LynxNfc {
    return this.instance!;
  },
};

@Component({ selector: 'nfc-holder', imports: [LYNX_ELEMENTS], template: '' })
class NfcHolder {
  constructor() {
    TestNfc.instance = inject(LynxNfc);
  }
}

describe('failNfcSession', () => {
  it('ends the open read as iOS does when the person closes its sheet', async () => {
    await render(MembershipCard);
    await tap('Read card');
    failNfcSession('canceled');
    await settle();
    expect(screen.getByText('Error: canceled')).toBeInTheDocument();
  });

  it('ends the next session as soon as it opens', async () => {
    await render(NfcHolder);
    const nfc = TestNfc.get();
    failNfcSession('timeout', 'Too slow.');
    tapNfcTag();
    await expect(nfc.read()).rejects.toEqual(
      new NfcError('timeout', 'Too slow.'),
    );
    // The tap queued after the failure is still waiting for a session.
    await expect(nfc.read()).resolves.toMatchObject({ records: [] });
  });
});

describe('setNfcState', () => {
  it('turns NFC off, which a read and the state report', async () => {
    setNfcState('disabled');
    await render(MembershipCard);
    await settle();
    expect(screen.getByText('State: disabled')).toBeInTheDocument();
    await tap('Read card');
    expect(screen.getByText('Error: disabled')).toBeInTheDocument();

    // The person turns it on in Settings and comes back.
    setNfcState('ready');
    setAppState('background');
    await settle();
    setAppState('active');
    await settle();
    expect(screen.getByText('State: ready')).toBeInTheDocument();
  });

  it('says a phone without a reader is unsupported', async () => {
    setNfcState('unsupported');
    await render(MembershipCard);
    await tap('Read card');
    expect(screen.getByText('Error: unsupported')).toBeInTheDocument();
  });

  it('refuses a second session while one is open', async () => {
    await render(NfcHolder);
    const nfc = TestNfc.get();
    const first = nfc.read();
    await settle();
    await expect(nfc.read()).rejects.toMatchObject({ code: 'busy' });
    tapNfcTag();
    await expect(first).resolves.toBeDefined();
  });
});

describe('the fake NFC module', () => {
  it('starts each test with no session and no writes', () => {
    expect(nfcSession()).toBeUndefined();
    expect(nfcWrites()).toEqual([]);
  });

  describe('outside the environment', () => {
    let env: unknown;
    afterEach(() => {
      (globalThis as any).lynxTestingEnv = env;
    });

    it('says the setup file is missing', () => {
      env = (globalThis as any).lynxTestingEnv;
      (globalThis as any).lynxTestingEnv = undefined;
      expect(() => tapNfcTag()).toThrowError(
        /tapNfcTag\(\) needs the testing library/,
      );
      expect(() => nfcWrites()).toThrowError(
        /nfcWrites\(\) needs the testing library/,
      );
    });
  });
});
