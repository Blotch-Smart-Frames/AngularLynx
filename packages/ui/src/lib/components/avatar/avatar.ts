import {
  Component,
  ViewEncapsulation,
  computed,
  input,
  signal,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import { UiSkeleton } from '../skeleton/skeleton';
import { cn } from '../../utils/cn';

@Component({
  selector: 'ui-avatar',
  standalone: true,
  imports: [LYNX_ELEMENTS, UiSkeleton],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view [class]="containerClass()">
      @if (src() && !errored()) {
        <!-- The <image> stays mounted whenever src is set so its bindload /
             binderror events can fire — an @if-swapped-out image would never
             start loading, so the load event that reveals it would never come.
             Native Lynx <image> renders nothing until loaded (there is no
             broken-image glyph like the web), so while loading the box is
             simply empty; the skeleton below sits on top of it as a placeholder.
             onImageLoad() flips the loaded state, removing the skeleton to
             reveal the image underneath. -->
        <image
          [attr.src]="src()"
          [class]="imageClass()"
          (bindload)="onImageLoad()"
          (binderror)="onImageError()"
        />
        <!-- Overlay placeholder shown only while the image is loading. It paints
             above the <image> because it comes later in source order (Lynx paint
             order follows the DOM, so no z-index is needed). -->
        @if (!loaded()) {
          <ui-skeleton [class]="skeletonClass()" />
        }
      } @else {
        <!-- Shared by the no-src case and the load-error case: initials if a
             fallback was provided, otherwise a plain muted circle. -->
        <view [class]="fallbackClass()">
          <text [class]="initialsClass()">{{ fallback() }}</text>
        </view>
      }
    </view>
  `,
})
export class UiAvatar {
  readonly src = input<string>('');
  readonly fallback = input<string>('');
  readonly size = input<'default' | 'sm' | 'lg' | 'xl' | '2xl'>('default');
  readonly userClass = input<string>('', { alias: 'class' });

  /** True once the remote image has successfully loaded. */
  protected readonly loaded = signal(false);
  /** True if the remote image failed to load (offline / firewall / 404). */
  protected readonly errored = signal(false);

  /**
   * Reveal the image by removing the skeleton overlay once it loads.
   *
   * Guarded against re-entrancy: on Lynx, starting or canceling an element
   * animation can synchronously re-dispatch the image's `load` event — and
   * removing the skeleton here tears down its pulse animation, which does
   * exactly that. Without the one-way `loaded` latch short-circuiting the
   * re-entry, this handler recurses and overflows the main-thread stack.
   */
  protected onImageLoad(): void {
    if (this.loaded()) return;
    this.loaded.set(true);
  }

  /**
   * On load failure, drop the skeleton and fall through to the fallback so a
   * broken image does not leave the placeholder pulsing forever. Guarded for
   * the same re-entrancy reason as onImageLoad().
   */
  protected onImageError(): void {
    if (this.errored()) return;
    this.errored.set(true);
  }

  protected readonly containerClass = computed(() =>
    cn(
      // `relative` makes the container the positioning context for the absolutely
      // positioned skeleton overlay below.
      'items-center rounded-full flex relative justify-center overflow-hidden',
      {
        'h-10 w-10': this.size() === 'default',
        'h-8 w-8': this.size() === 'sm',
        'h-14 w-14': this.size() === 'lg',
        'h-20 w-20': this.size() === 'xl',
        'h-28 w-28': this.size() === '2xl',
      },
      this.userClass(),
    ),
  );

  protected readonly imageClass = computed(() =>
    cn('h-full w-full', {
      'h-10 w-10': this.size() === 'default',
      'h-8 w-8': this.size() === 'sm',
      'h-14 w-14': this.size() === 'lg',
      'h-20 w-20': this.size() === 'xl',
      'h-28 w-28': this.size() === '2xl',
    }),
  );

  // Skeleton overlay filling the circular container. `inset-0` and `h-full
  // w-full` together guard against flex-collapse; `rounded-full` matches the
  // container (which also `overflow-hidden`-clips it to a circle).
  protected readonly skeletonClass = computed(() =>
    cn('h-full w-full rounded-full absolute inset-0'),
  );

  protected readonly fallbackClass = computed(() =>
    cn('h-full w-full items-center rounded-full bg-muted flex justify-center'),
  );

  protected readonly initialsClass = computed(() =>
    cn('font-medium text-muted-foreground', {
      'text-sm': this.size() === 'default' || this.size() === 'sm',
      'text-lg': this.size() === 'lg',
      'text-2xl': this.size() === 'xl',
      'text-3xl': this.size() === '2xl',
    }),
  );
}
