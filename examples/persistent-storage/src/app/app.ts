import { Component, computed, inject, signal } from '@angular/core';
import {
  BiometricsError,
  LYNX_ELEMENTS,
  LynxLocalStorage,
  LynxSecureStorage,
} from '@blotch/angular-lynx';

type Session = { user: string; token: string };

@Component({
  selector: 'app-root',
  template: `
    <scroll-view class="h-full bg-zinc-50" scroll-orientation="vertical">
      <view
        class="px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-[calc(1.5rem+env(safe-area-inset-top))]"
      >
        <text class="mb-1 text-[28px] font-bold text-zinc-900">
          Persistent Storage
        </text>
        <text class="mb-5 text-[13px] text-zinc-500">
          Values that are still there after the app restarts.
        </text>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-2.5 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            Local storage
          </text>
          <text class="mb-3 text-[24px] font-bold text-zinc-900">
            Launches: {{ launches() ?? '…' }}
          </text>
          <view
            class="items-center rounded-[10px] bg-red-500 px-6 py-3"
            (bindtap)="resetLaunches()"
          >
            <text class="text-[15px] font-semibold text-white">Reset</text>
          </view>
        </view>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-2.5 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            Secure storage
          </text>
          <text class="mb-3 text-[15px] text-zinc-900">{{ status() }}</text>
          <view
            class="items-center rounded-[10px] bg-indigo-500 px-6 py-3"
            (bindtap)="locked() ? unlock() : session() ? signOut() : signIn()"
          >
            <text class="text-[15px] font-semibold text-white">
              {{ locked() ? 'Unlock' : session() ? 'Sign out' : 'Sign in' }}
            </text>
          </view>
        </view>

        @if (error()) {
          <text class="text-[13px] text-red-600">{{ error() }}</text>
        }
      </view>
    </scroll-view>
  `,
  imports: [LYNX_ELEMENTS],
})
export class App {
  readonly #local = inject(LynxLocalStorage);
  readonly #secure = inject(LynxSecureStorage);

  readonly launches = signal<number | undefined>(undefined);
  readonly session = signal<Session | null>(null);
  /** Whether the person closed the prompt, so the session stays locked. */
  readonly locked = signal(false);
  readonly status = computed(() => {
    const session = this.session();
    if (this.locked()) return 'Locked: unlock to see the session';
    if (!session) return 'Signed out';
    return `Signed in as ${session.user}`;
  });
  readonly error = signal('');

  constructor() {
    this.#run(async () => {
      // Counts every start of the app, so restart it to see the count go up.
      const launches =
        ((await this.#local.getItem<number>('launches')) ?? 0) + 1;
      await this.#local.setItem('launches', launches);
      this.launches.set(launches);
    });
    this.unlock();
  }

  /**
   * Reads the session, which asks for Face ID, Touch ID or a fingerprint
   * first when it was kept behind them.
   */
  unlock(): void {
    this.#run(async () => {
      try {
        this.session.set(
          await this.#secure.getItem<Session>('session', {
            reason: 'Unlock your session',
          }),
        );
        this.locked.set(false);
      } catch (error) {
        if (!(error instanceof BiometricsError)) throw error;
        this.locked.set(true);
      }
    });
  }

  resetLaunches(): void {
    this.#run(async () => {
      await this.#local.removeItem('launches');
      this.launches.set(0);
    });
  }

  signIn(): void {
    this.#run(async () => {
      // A stand-in for the token a sign-in would return.
      const session = {
        user: 'ada',
        token: Math.random().toString(36).slice(2),
      };
      // Behind biometrics where the phone has them. The web preview, and a
      // phone without a passcode or a face or finger set up, don't, and keep
      // it as a plain secret. Any other failure is shown.
      try {
        await this.#secure.setItem('session', session, {
          requireBiometrics: true,
        });
      } catch (error) {
        if (
          !(error instanceof BiometricsError) ||
          (error.code !== 'unavailable' && error.code !== 'notEnrolled')
        ) {
          throw error;
        }
        await this.#secure.setItem('session', session);
      }
      this.session.set(session);
    });
  }

  signOut(): void {
    this.#run(async () => {
      await this.#secure.removeItem('session');
      this.session.set(null);
      this.locked.set(false);
    });
  }

  /**
   * Shows why a call failed, such as a Keychain error.
   */
  #run(task: () => Promise<void>): void {
    task().catch((error: Error) => this.error.set(error.message));
  }
}
