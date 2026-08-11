import { Component, signal, viewChild, type ElementRef } from '@angular/core';
import { LYNX_ELEMENTS, type LynxAnimation } from '@blotch/angular-lynx';

@Component({
  selector: 'app-root',
  template: `
    <scroll-view class="h-full bg-zinc-50" scroll-orientation="vertical">
      <view class="p-6">
        <text class="mb-1 text-[28px] font-bold text-zinc-900">Animations</text>
        <text class="mb-5 text-[13px] text-zinc-500">
          CSS transitions, keyframes, and the JS animate() API.
        </text>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-3 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            CSS Transition
          </text>
          <view
            class="demo-box transition-box"
            [class.transition-active]="transitionOn()"
            (bindtap)="toggleTransition()"
          >
            <text class="text-sm font-medium text-white">Tap to toggle</text>
          </view>
        </view>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-3 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            CSS Keyframes
          </text>
          <view
            class="demo-box keyframe-box"
            [class.spinning]="spinOn()"
            (bindtap)="toggleSpin()"
          >
            <text class="text-sm font-medium text-white">Tap to spin</text>
          </view>
        </view>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-3 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            JS animate() API
          </text>
          <view
            #animBox
            class="demo-box animate-box"
            (bindtap)="runAnimation()"
          >
            <text class="text-sm font-medium text-white">Tap to pulse</text>
          </view>
        </view>
      </view>
    </scroll-view>
  `,
  styles: [
    `
      .demo-box {
        align-items: center;
        justify-content: center;
        border-radius: 10px;
      }

      .transition-box {
        width: 140px;
        height: 60px;
        background-color: #6366f1;
        transition: background-color 0.5s ease-in-out;
      }
      .transition-active {
        background-color: #22c55e;
      }

      @keyframes rotate {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }
      .keyframe-box {
        width: 80px;
        height: 80px;
        background-color: #f97316;
      }
      .spinning {
        animation: rotate 1s linear infinite;
      }

      .animate-box {
        width: 140px;
        height: 60px;
        background-color: #3b82f6;
      }
    `,
  ],
  imports: [LYNX_ELEMENTS],
})
export class App {
  readonly transitionOn = signal(false);
  readonly spinOn = signal(false);
  readonly animBoxRef = viewChild<ElementRef>('animBox');

  #anim: LynxAnimation | null = null;

  toggleTransition(): void {
    setTimeout(() => this.transitionOn.update((v) => !v), 0);
  }

  toggleSpin(): void {
    setTimeout(() => this.spinOn.update((v) => !v), 0);
  }

  runAnimation(): void {
    setTimeout(() => {
      const el = this.animBoxRef();
      if (!el) return;
      this.#anim?.cancel();
      this.#anim = el.nativeElement.animate(
        [
          { transform: 'scale(1)', opacity: 1 },
          { transform: 'scale(1.3)', opacity: 0.7 },
          { transform: 'scale(1)', opacity: 1 },
        ],
        { duration: 600, easing: 'ease-in-out' },
      );
    }, 0);
  }
}
