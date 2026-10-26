import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

@Component({
  selector: 'app-root',
  template: `
    <scroll-view class="h-full bg-zinc-50" scroll-orientation="vertical">
      <view class="p-6">
        <text class="mb-1 text-[28px] font-bold text-zinc-900">
          Error Handling
        </text>
        <text class="mb-5 text-[13px] text-zinc-500">
          Show the last uncaught error, which LynxErrorHandler saves in
          __lynxLastError.
        </text>

        <view
          class="mb-4 items-center rounded-[10px] bg-indigo-500 px-6 py-3"
          (bindtap)="throwError()"
        >
          <text class="text-[15px] font-semibold text-white">
            Throw an Error
          </text>
        </view>

        <view class="rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-2.5 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
            >__lynxLastError
          </text>
          <!-- Each color is bound on its own condition: with two
               background (or text) colors on one element, the stylesheet's
               order decides, not the binding. -->
          <view
            class="rounded-lg p-3.5"
            [class.bg-zinc-100]="!lastError()"
            [class.bg-red-50]="!!lastError()"
          >
            <text
              class="text-xs break-all"
              [class.text-zinc-500]="!lastError()"
              [class.text-red-800]="!!lastError()"
            >
              {{ lastError() || '(none)' }}
            </text>
          </view>
        </view>
      </view>
    </scroll-view>
  `,
  imports: [LYNX_ELEMENTS],
})
export class App {
  readonly lastError = signal('');

  throwError(): void {
    // Nothing catches this error, so Angular hands it to LynxErrorHandler (set
    // up by provideRenderer()), which saves it in __lynxLastError and reports
    // it to Lynx. Lynx Explorer shows its error screen for that report.
    //
    // __lynxLastError is a plain global, so copying it into a signal is what
    // re-renders the screen. Angular handles the error synchronously, as the
    // throw leaves this handler, so a microtask queued first reads it after
    // it has been saved.
    queueMicrotask(() =>
      this.lastError.set((globalThis as any).__lynxLastError ?? ''),
    );
    throw new Error('Example error from component');
  }
}
