import { Component, signal, viewChild, type ElementRef } from '@angular/core';
import { LYNX_ELEMENTS, type LynxAnimation } from '@blotch/angular-lynx';
import { UiBadge } from '../../components/ui/badge';
import { UiButton } from '../../components/ui/button';
import { UiCard } from '../../components/ui/card';
import { UiIcon } from '../../components/ui/icon';
import { type IconName } from '../../components/ui/icon/icons';
import { UiText } from '../../components/ui/typography';
import { DemoScreen } from '../demo-screen/demo-screen';
import { ScreenHost } from '../screen-host';

/** One looping `@keyframes` preset shown as a tappable tile. */
type KeyframeTile = {
  name: string;
  label: string;
  icon: IconName;
  blurb: string;
};

/** The one-shot animations the JS `element.animate()` section can play. */
type AnimatePreset = 'pop' | 'shake' | 'flash';

@Component({
  selector: 'app-motion-demo',
  hostDirectives: [ScreenHost],
  imports: [
    LYNX_ELEMENTS,
    DemoScreen,
    UiCard,
    UiText,
    UiBadge,
    UiButton,
    UiIcon,
  ],
  styleUrl: './motion-demo.css',
  template: `
    <app-demo-screen
      heading="Motion"
      category="Motion"
      description="Four ways to move pixels on Lynx: CSS transitions, looping @keyframes, the imperative JS animate() API, and animating a native overlay."
    >
      <!-- ── CSS Transitions ────────────────────────────────────────────────
           A property change (background-color + transform) interpolated over
           time. The switch below animates both when its class flips. -->
      <ui-card class="p-4">
        <view class="mb-1 flex-row items-center flex justify-between">
          <ui-text variant="large">CSS Transitions</ui-text>
          <ui-badge variant="outline">transition</ui-badge>
        </view>
        <ui-text variant="muted" class="mb-4">
          Interpolate between two states when a property changes. Tap the switch
          — the track color and knob position both ease to their new values.
        </ui-text>

        <view class="flex-col items-center gap-4 py-2 flex">
          <view
            class="motion-track items-center flex {{
              switchOn() ? 'is-on' : ''
            }}"
            (bindtap)="toggleSwitch()"
          >
            <view class="motion-knob {{ switchOn() ? 'is-on' : '' }}" />
          </view>
          <ui-badge [variant]="switchOn() ? 'default' : 'secondary'">
            {{ switchOn() ? 'On' : 'Off' }}
          </ui-badge>
        </view>
      </ui-card>

      <!-- ── Keyframe Animations ────────────────────────────────────────────
           Declarative, multi-step animations that loop forever. Each tile
           toggles its @keyframes class on the inner icon wrapper. -->
      <ui-card class="p-4">
        <view class="mb-1 flex-row items-center flex justify-between">
          <ui-text variant="large">Keyframe Animations</ui-text>
          <ui-badge variant="outline">&#64;keyframes</ui-badge>
        </view>
        <ui-text variant="muted" class="mb-4">
          Multi-step animations that run on a loop. Tap a tile to start or stop
          its animation.
        </ui-text>

        <view class="flex-col gap-3 flex">
          @for (tile of keyframeTiles; track tile.name) {
            @let active = isKeyframeActive(tile.name);
            <view
              class="flex-row items-center gap-3 rounded-lg border p-3 flex {{
                active ? 'border-primary bg-secondary' : 'border-border bg-card'
              }}"
              (bindtap)="toggleKeyframe(tile.name)"
            >
              <view
                class="h-11 w-11 items-center rounded-lg bg-muted flex justify-center"
              >
                <!-- The animation class lives on this wrapper, not the icon, so
                     the icon's fixed-size SVG isn't disturbed by the transform. -->
                <view class="{{ active ? 'anim-' + tile.name : '' }}">
                  <ui-icon [name]="tile.icon" size="md" />
                </view>
              </view>
              <view class="flex-1 flex-col flex">
                <text class="text-sm font-medium text-foreground">
                  {{ tile.label }}
                </text>
                <text class="text-xs text-muted-foreground">
                  {{ tile.blurb }}
                </text>
              </view>
              <ui-badge [variant]="active ? 'default' : 'outline'">
                {{ active ? 'Playing' : 'Paused' }}
              </ui-badge>
            </view>
          }
        </view>
      </ui-card>

      <!-- ── JS Animate API ─────────────────────────────────────────────────
           Imperative, one-shot animations driven from TypeScript via
           element.animate(). Each button plays a different keyframe array. -->
      <ui-card class="p-4">
        <view class="mb-1 flex-row items-center flex justify-between">
          <ui-text variant="large">JS Animate API</ui-text>
          <ui-badge variant="outline">element.animate()</ui-badge>
        </view>
        <ui-text variant="muted" class="mb-4">
          Fire one-shot animations from code. Each button passes a different
          keyframe array to the native animate() call.
        </ui-text>

        <view class="flex-col items-center gap-4 flex">
          <view
            class="min-h-[104px] w-full items-center rounded-lg border border-dashed border-border bg-muted p-4 flex justify-center"
          >
            <view
              #animateBox
              class="h-16 w-16 items-center rounded-2xl bg-secondary flex justify-center"
            >
              <ui-icon name="star" size="lg" />
            </view>
          </view>

          <view class="w-full flex-row gap-2 flex">
            <ui-button class="flex-1" size="sm" (pressed)="runAnimation('pop')">
              Pop
            </ui-button>
            <ui-button
              class="flex-1"
              size="sm"
              variant="secondary"
              (pressed)="runAnimation('shake')"
            >
              Shake
            </ui-button>
            <ui-button
              class="flex-1"
              size="sm"
              variant="outline"
              (pressed)="runAnimation('flash')"
            >
              Flash
            </ui-button>
          </view>
        </view>
      </ui-card>

      <!-- ── Overlay Animation ──────────────────────────────────────────────
           The JS animate() API driving a native <overlay> — a separate render
           layer outside the document flow. Same imperative API as above, but
           coordinating two elements (backdrop fade + dialog spring). -->
      <ui-card class="p-4">
        <view class="mb-1 flex-row items-center flex justify-between">
          <ui-text variant="large">Overlay Animation</ui-text>
          <ui-badge variant="outline">overlay</ui-badge>
        </view>
        <ui-text variant="muted" class="mb-4">
          Animate a native overlay — rendered on its own layer, above everything
          else — with the same animate() API. The backdrop fades in while the
          dialog springs up, and both reverse on close.
        </ui-text>

        <ui-button (pressed)="openOverlay()">Open Animated Dialog</ui-button>

        <!-- The overlay renders outside this card's tree on a dedicated native
             layer, so it fills the whole screen regardless of where it sits in
             the template. The fixed + overflow-visible classes mirror ui-dialog. -->
        <overlay
          [attr.visible]="overlayVisible()"
          class="fixed overflow-visible"
        >
          <view
            #overlayBackdrop
            class="overlay-backdrop h-full w-full items-center bg-black/50 flex justify-center"
            (bindtap)="closeOverlay()"
          >
            <view
              #overlayDialog
              class="overlay-dialog w-4/5 flex-col rounded-2xl border border-border bg-card p-6 flex"
              (catchtap)="onDialogTap()"
            >
              <view class="mb-3 flex-row items-center gap-2 flex">
                <view
                  class="h-9 w-9 items-center rounded-full bg-secondary flex justify-center"
                >
                  <ui-icon name="star" size="sm" />
                </view>
                <ui-text variant="large">Animated Dialog</ui-text>
              </view>
              <ui-text variant="muted" class="mb-5">
                This overlay fades its backdrop and springs the panel in with a
                combined scale + fade, then reverses on close — all driven by
                element.animate().
              </ui-text>
              <view class="flex-row gap-2 flex justify-end">
                <ui-button
                  class="flex-1"
                  variant="outline"
                  size="sm"
                  (pressed)="closeOverlay()"
                >
                  Cancel
                </ui-button>
                <ui-button class="flex-1" size="sm" (pressed)="closeOverlay()">
                  Confirm
                </ui-button>
              </view>
            </view>
          </view>
        </overlay>
      </ui-card>

      <!-- ── How it works ───────────────────────────────────────────────────
           A short mental model so the demo teaches, not just entertains. -->
      <ui-card class="p-4">
        <view class="mb-2 flex-row items-center gap-2 flex">
          <ui-icon name="info" size="sm" />
          <ui-text variant="large">How it works</ui-text>
        </view>
        <view class="flex-col gap-3 flex">
          <view class="flex-row items-center gap-2 flex">
            <ui-badge variant="outline">transition</ui-badge>
            <ui-text variant="muted" class="flex-1">
              Eases a property to its new value whenever the value changes.
            </ui-text>
          </view>
          <view class="flex-row items-center gap-2 flex">
            <ui-badge variant="outline">&#64;keyframes</ui-badge>
            <ui-text variant="muted" class="flex-1">
              Declarative multi-step timelines that can loop forever.
            </ui-text>
          </view>
          <view class="flex-row items-center gap-2 flex">
            <ui-badge variant="outline">animate()</ui-badge>
            <ui-text variant="muted" class="flex-1">
              Imperative one-shots triggered from code, cancellable mid-flight.
            </ui-text>
          </view>
          <view class="flex-row items-center gap-2 flex">
            <ui-badge variant="outline">overlay</ui-badge>
            <ui-text variant="muted" class="flex-1">
              A native layer above the page, animated with the same animate()
              API.
            </ui-text>
          </view>
        </view>
        <ui-text variant="muted" class="mt-4">
          On Lynx, Angular runs on the background thread, which has no
          animationend bridge for animate() — so the JS API's durations are
          managed by the caller rather than waited on.
        </ui-text>
      </ui-card>
    </app-demo-screen>
  `,
})
export class MotionDemo {
  /** CSS-transition switch state. */
  readonly switchOn = signal(false);

  /** Names of the keyframe tiles that are currently looping. */
  readonly activeKeyframes = signal<ReadonlySet<string>>(new Set());

  /** ViewChild gives us the native LynxElement for the JS animate API. */
  readonly animateBoxRef = viewChild<ElementRef>('animateBox');

  #currentAnimation: LynxAnimation | null = null;

  /** Whether the native overlay layer is mounted and visible. */
  readonly overlayVisible = signal(false);

  /** Native elements for the overlay's backdrop and dialog, animated by hand. */
  readonly overlayBackdropRef = viewChild<ElementRef>('overlayBackdrop');
  readonly overlayDialogRef = viewChild<ElementRef>('overlayDialog');

  #backdropAnim: LynxAnimation | null = null;
  #dialogAnim: LynxAnimation | null = null;

  /** The four looping presets, each with a matching class in the stylesheet. */
  readonly keyframeTiles: readonly KeyframeTile[] = [
    { name: 'spin', label: 'Spin', icon: 'loader', blurb: 'rotate 360°' },
    { name: 'pulse', label: 'Pulse', icon: 'heart', blurb: 'scale + fade' },
    {
      name: 'bounce',
      label: 'Bounce',
      icon: 'chevron-up',
      blurb: 'translateY',
    },
    { name: 'shake', label: 'Shake', icon: 'bell', blurb: 'translateX' },
  ];

  isKeyframeActive(name: string): boolean {
    return this.activeKeyframes().has(name);
  }

  /**
   * All handlers defer their signal writes via setTimeout so the update never
   * happens synchronously inside a Lynx native event handler (bindtap, or the
   * UiButton `pressed` output which emits inside bindtap). A synchronous write
   * can flush the renderer while the native event is still on the call stack,
   * which breaks Lynx's main-thread frame pipeline.
   */
  toggleSwitch(): void {
    setTimeout(() => this.switchOn.update((v) => !v), 0);
  }

  toggleKeyframe(name: string): void {
    setTimeout(() => {
      this.activeKeyframes.update((active) => {
        const next = new Set(active);
        if (next.has(name)) {
          next.delete(name);
        } else {
          next.add(name);
        }
        return next;
      });
    }, 0);
  }

  runAnimation(preset: AnimatePreset): void {
    setTimeout(() => {
      const el = this.animateBoxRef();
      if (!el) return;

      // Cancel any previously running animation so they don't stack.
      this.#currentAnimation?.cancel();

      const native = el.nativeElement;
      switch (preset) {
        case 'pop':
          this.#currentAnimation = native.animate(
            [
              { transform: 'scale(1)' },
              { transform: 'scale(1.35)' },
              { transform: 'scale(1)' },
            ],
            { duration: 500, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
          );
          break;
        case 'shake':
          this.#currentAnimation = native.animate(
            [
              { transform: 'translateX(0px)' },
              { transform: 'translateX(-8px)' },
              { transform: 'translateX(8px)' },
              { transform: 'translateX(-8px)' },
              { transform: 'translateX(0px)' },
            ],
            { duration: 450, easing: 'ease-in-out' },
          );
          break;
        case 'flash':
          this.#currentAnimation = native.animate(
            [
              { opacity: 1 },
              { opacity: 0.2 },
              { opacity: 1 },
              { opacity: 0.2 },
              { opacity: 1 },
            ],
            { duration: 600, easing: 'ease-in-out' },
          );
          break;
      }
    }, 0);
  }

  /**
   * Two-phase open: make the overlay visible so its elements mount into the
   * native tree, then animate on the next frame — Lynx's animate() requires the
   * target to already exist. Deferred via setTimeout so the signal write never
   * happens synchronously inside the button's native tap callback.
   */
  openOverlay(): void {
    setTimeout(() => {
      this.overlayVisible.set(true);
      setTimeout(() => this.#animateOverlayIn(), 0);
    }, 0);
  }

  closeOverlay(): void {
    setTimeout(() => this.#animateOverlayOut(), 0);
  }

  /**
   * No-op tap handler for the dialog panel. `catchtap` already stops the tap
   * from bubbling to the backdrop (which would close the dialog) — Lynx controls
   * propagation via the event prefix, not `event.stopPropagation()`.
   */
  onDialogTap(): void {}

  #animateOverlayIn(): void {
    const backdrop = this.overlayBackdropRef()?.nativeElement;
    const dialog = this.overlayDialogRef()?.nativeElement;
    if (!backdrop || !dialog) return;

    this.#backdropAnim?.cancel();
    this.#dialogAnim?.cancel();

    // Backdrop: fade the dim layer in.
    this.#backdropAnim = backdrop.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 250,
      easing: 'ease-out',
      fill: 'forwards',
    });

    // Dialog: spring up + fade in. The spring easing gives a gentle overshoot.
    this.#dialogAnim = dialog.animate(
      [
        { transform: 'scale(0.85) translateY(20px)', opacity: 0 },
        { transform: 'scale(1) translateY(0px)', opacity: 1 },
      ],
      {
        duration: 300,
        easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        fill: 'forwards',
      },
    );
  }

  #animateOverlayOut(): void {
    const backdrop = this.overlayBackdropRef()?.nativeElement;
    const dialog = this.overlayDialogRef()?.nativeElement;
    if (!backdrop || !dialog) return;

    this.#backdropAnim?.cancel();
    this.#dialogAnim?.cancel();

    // Backdrop: fade the dim layer out.
    this.#backdropAnim = backdrop.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 200,
      easing: 'ease-in',
      fill: 'forwards',
    });

    // Dialog: scale down + fade out (the reverse of the entrance).
    this.#dialogAnim = dialog.animate(
      [
        { transform: 'scale(1) translateY(0px)', opacity: 1 },
        { transform: 'scale(0.85) translateY(20px)', opacity: 0 },
      ],
      { duration: 200, easing: 'ease-in', fill: 'forwards' },
    );

    // Unmount the overlay once the exit finishes. Lynx doesn't fire
    // animationend for the JS animate() API on the background thread, so the
    // caller manages the timing — matched to the longest exit duration.
    setTimeout(() => this.overlayVisible.set(false), 220);
  }
}
