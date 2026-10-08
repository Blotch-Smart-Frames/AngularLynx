import {
  ChangeDetectionStrategy,
  Component,
  inject,
  resource,
  signal,
  untracked,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { BoundaryLog } from './boundary-log';
import {
  OfflineError,
  PriceTile,
  ProfileCard,
  type ProfileFailure,
} from './widgets';

const QUOTES = [
  'Simplicity is prerequisite for reliability.',
  'Make it work, make it right, make it fast.',
  'The best error message is the one that never shows up.',
];

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

@Component({
  selector: 'app-root',
  template: `
    <scroll-view class="h-full bg-zinc-50" scroll-orientation="vertical">
      <view class="p-6">
        <text class="mb-1 text-[28px] font-bold text-zinc-900">
          Error Boundaries
        </text>
        <text class="mb-5 text-[13px] text-zinc-500">
          Contain rendering failures with &#64;boundary and recover with $reset.
        </text>

        <!-- 1. A crash in one widget swaps in a fallback, nothing else breaks -->
        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text class="mb-3 text-[11px] font-bold uppercase text-zinc-400">
            Recover with $reset
          </text>

          @boundary {
            <app-price-tile symbol="LYNX" [price]="price()" />
          } @error (let err, retry = $reset) {
            <view class="rounded-lg bg-red-50 p-3">
              <text class="mb-2 text-[13px] text-red-800">{{ err.message }}</text>
              <view
                class="self-start rounded-lg bg-red-600 px-3 py-1.5"
                (bindtap)="restorePrice(); retry()"
              >
                <text class="text-[13px] font-semibold text-white">Retry</text>
              </view>
            </view>
          }

          <view
            class="mt-3 items-center rounded-[10px] bg-zinc-900 py-2.5"
            (bindtap)="sendBadPrice()"
          >
            <text class="text-[14px] font-semibold text-white">
              Send bad data
            </text>
          </view>
        </view>

        <!-- 2. Different errors, different fallbacks -->
        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text class="mb-3 text-[11px] font-bold uppercase text-zinc-400">
            Pick a fallback with when
          </text>

          @boundary {
            <app-profile-card [failure]="failure()" />
          } @error (let err, retry = $reset; when isOffline(err)) {
            <view class="flex flex-row items-center rounded-lg bg-amber-50 p-3">
              <text class="flex-1 text-[13px] text-amber-800">
                You're offline. We'll show your profile once you reconnect.
              </text>
              <view
                class="ml-2 rounded-lg bg-amber-500 px-3 py-1.5"
                (bindtap)="failure.set('none'); retry()"
              >
                <text class="text-[13px] font-semibold text-white">Reconnect</text>
              </view>
            </view>
          } @error (let err, retry = $reset) {
            <view class="rounded-lg bg-red-50 p-3">
              <text class="mb-2 text-[13px] text-red-800">
                Something went wrong: {{ err.message }}
              </text>
              <view
                class="self-start rounded-lg bg-red-600 px-3 py-1.5"
                (bindtap)="failure.set('none'); retry()"
              >
                <text class="text-[13px] font-semibold text-white">Retry</text>
              </view>
            </view>
          }

          <view class="mt-3 flex flex-row">
            <view
              class="mr-2 flex-1 items-center rounded-[10px] bg-zinc-900 py-2.5"
              (bindtap)="failure.set('offline')"
            >
              <text class="text-[14px] font-semibold text-white">Go offline</text>
            </view>
            <view
              class="flex-1 items-center rounded-[10px] bg-zinc-900 py-2.5"
              (bindtap)="failure.set('bug')"
            >
              <text class="text-[14px] font-semibold text-white">
                Trigger bug
              </text>
            </view>
          </view>
        </view>

        <!-- 3. resource() values throw in the error state; the boundary catches it -->
        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text class="mb-3 text-[11px] font-bold uppercase text-zinc-400">
            Async data with resource()
          </text>

          <!--
            The guard matters: value() is undefined during the first load and
            while reloading after an error. Showing the loader here also tears
            the boundary down, so each successful load gets a fresh one.
          -->
          @if (quote.isLoading() && !quote.hasValue()) {
            <text class="text-[14px] text-zinc-400">Loading quote…</text>
          } @else {
            @boundary {
              <text class="text-[15px] italic text-zinc-800">
                “{{ quote.value() }}”
              </text>
            } @error {
              <!--
                The caught error is a ResourceValueError wrapper; the loader's
                own error is on quote.error().
              -->
              <view class="rounded-lg bg-red-50 p-3">
                <text class="mb-2 text-[13px] text-red-800">
                  {{ quote.error()?.message }}
                </text>
                <view
                  class="self-start rounded-lg bg-red-600 px-3 py-1.5"
                  (bindtap)="quote.reload()"
                >
                  <text class="text-[13px] font-semibold text-white">
                    Try again
                  </text>
                </view>
              </view>
            }
          }

          <view class="mt-3 flex flex-row">
            <view
              class="mr-2 flex-1 items-center rounded-[10px] bg-zinc-900 py-2.5"
              (bindtap)="nextQuote()"
            >
              <text class="text-[14px] font-semibold text-white">Next quote</text>
            </view>
            <view
              class="flex-1 items-center rounded-[10px] py-2.5"
              [class.bg-red-600]="failNextLoad()"
              [class.bg-zinc-200]="!failNextLoad()"
              (bindtap)="failNextLoad.set(!failNextLoad())"
            >
              <text
                class="text-[14px] font-semibold"
                [class.text-white]="failNextLoad()"
                [class.text-zinc-700]="!failNextLoad()"
              >
                {{ failNextLoad() ? 'Next load fails' : 'Next load works' }}
              </text>
            </view>
          </view>
        </view>

        <!-- 4. Caught errors still reach the ErrorHandler via onViewError -->
        <view class="rounded-xl border border-zinc-200 bg-white p-4">
          <view class="mb-2.5 flex flex-row items-center justify-between">
            <text class="text-[11px] font-bold uppercase text-zinc-400">
              ErrorHandler.onViewError
            </text>
            @if (log.entries().length > 0) {
              <text class="text-xs text-indigo-500" (bindtap)="log.clear()">
                Clear
              </text>
            }
          </view>
          @for (entry of log.entries(); track entry.id) {
            <view class="mb-1.5 rounded-lg bg-zinc-100 p-2.5">
              <text class="text-[11px] font-semibold text-zinc-500">
                {{ entry.name }}
              </text>
              <text class="text-xs text-zinc-700">{{ entry.message }}</text>
            </view>
          } @empty {
            <text class="text-xs text-zinc-400">(no caught errors yet)</text>
          }
        </view>
      </view>
    </scroll-view>
  `,
  imports: [LYNX_ELEMENTS, PriceTile, ProfileCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  readonly log = inject(BoundaryLog);

  readonly price = signal(128.42);
  readonly failure = signal<ProfileFailure>('none');
  readonly failNextLoad = signal(false);
  readonly #quoteIndex = signal(0);

  readonly quote = resource({
    params: () => this.#quoteIndex(),
    loader: async ({ params: index }) => {
      // Simulated network latency so the loading state is visible.
      await delay(700);
      // Read without tracking: flipping the switch shouldn't trigger a load.
      if (untracked(this.failNextLoad)) {
        throw new Error('Quote service returned 503');
      }
      return QUOTES[index % QUOTES.length];
    },
  });

  sendBadPrice(): void {
    this.price.set(Number.NaN);
  }

  restorePrice(): void {
    this.price.set(128.42);
  }

  nextQuote(): void {
    this.#quoteIndex.update((i) => i + 1);
  }

  isOffline(err: unknown): boolean {
    return err instanceof OfflineError;
  }
}
