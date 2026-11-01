import { Component, computed, inject, signal } from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxLocalStorage,
  LynxSecureStorage,
} from '@blotch/angular-lynx';

type Session = { user: string; token: string };

@Component({
  selector: 'app-root',
  template: `
    <scroll-view class="h-full bg-zinc-50" scroll-orientation="vertical">
      <view class="p-6">
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
            (bindtap)="session() ? signOut() : signIn()"
          >
            <text class="text-[15px] font-semibold text-white">
              {{ session() ? 'Sign out' : 'Sign in' }}
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
  readonly status = computed(() => {
    const session = this.session();
    return session ? `Signed in as ${session.user}` : 'Signed out';
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
    this.#run(async () => {
      this.session.set(await this.#secure.getItem<Session>('session'));
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
      await this.#secure.setItem('session', session);
      this.session.set(session);
    });
  }

  signOut(): void {
    this.#run(async () => {
      await this.#secure.removeItem('session');
      this.session.set(null);
    });
  }

  /**
   * Shows why a call failed, such as a Keychain error.
   */
  #run(task: () => Promise<void>): void {
    task().catch((error: Error) => this.error.set(error.message));
  }
}
