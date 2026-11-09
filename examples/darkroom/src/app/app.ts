import { Component, computed, inject, signal, viewChild } from '@angular/core';
import {
  ImagePickerError,
  LYNX_ELEMENTS,
  LynxImagePicker,
  LynxShare,
  ShareError,
} from '@blotch/angular-lynx';
import { loadImage } from './develop/surface';
import { Controls } from './sheet/controls';
import { Enlargement } from './sheet/enlargement';
import { MarkerRing } from './sheet/marks';
import { RollStrip } from './sheet/roll-strip';
import { TestStrip } from './sheet/test-strip';
import { DarkroomState } from './state/darkroom-state';

/** How long a note in the margin stays before it fades. */
const NOTE_MS = 2600;

/**
 * Darkroom: a proof sheet you mark up. The chosen frame enlarged and
 * developing live, the roll as a strip of contact prints, a test strip of
 * every stock, and the printer's controls, all on one sheet of paper. Every
 * choice is a red china-marker mark.
 */
@Component({
  selector: 'app-root',
  imports: [
    LYNX_ELEMENTS,
    Controls,
    Enlargement,
    MarkerRing,
    RollStrip,
    TestStrip,
  ],
  template: `
    <scroll-view class="h-full w-full bg-paper" scroll-orientation="vertical">
      <view class="flex flex-col pb-safe-6">
        <!-- The sheet's header: the app's name and the roll's code on the
             left, what can be done with the print on the right. -->
        <view
          class="flex flex-row items-center justify-between px-3 pt-safe-2 pb-2"
        >
          <view class="flex flex-col">
            <text class="font-edge text-[17px] tracking-[5px] text-ink"
              >DARKROOM</text
            >
            <text class="font-edge text-[10px] tracking-[2px] text-ink-muted"
              >ROLL 07 · {{ state.roll().length }} FRAMES</text
            >
          </view>
          <view class="flex flex-row items-center">
            <text
              class="px-2.5 py-3 font-edge text-[12px] tracking-[2px] text-ink"
              (bindtap)="load()"
              accessibility-traits="button"
              accessibility-label="Load a photo of your own"
              >LOAD</text
            >
            <text
              class="px-2.5 py-3 font-edge text-[12px] tracking-[2px] text-ink"
              (bindtap)="keep()"
              accessibility-traits="button"
              accessibility-label="Keep this development as a recipe"
              >KEEP</text
            >
            <view
              class="relative ml-1 flex items-center justify-center"
              style="width: 66px; height: 40px"
              (bindtap)="print()"
              accessibility-element="true"
              accessibility-traits="button"
              accessibility-label="Print: save or share the developed photo"
            >
              <!-- Faded while the print is made and the sheet is open. -->
              <text
                class="font-marker text-[17px] text-marker"
                [style.opacity]="printing() ? 0.35 : 1"
                >print</text
              >
              <app-ring
                [width]="66"
                [height]="40"
                [seed]="9"
                style="left: 0; top: 0"
              />
            </view>
          </view>
        </view>

        <app-enlargement #enlargement [frameNumber]="frameNumber()" />

        <!-- A note in the margin: what just happened, in marker. -->
        <view
          class="flex flex-row justify-between px-3 pt-2"
          style="height: 30px"
        >
          <text class="text-[12px] text-ink-muted" [text-maxline]="1">{{
            state.photo().title
          }}</text>
          @if (note()) {
            <text class="font-marker text-[14px] text-marker">{{
              note()
            }}</text>
          }
        </view>
        <app-roll-strip />
        <app-test-strip class="mt-3" />
        <text class="px-3 pt-1.5 text-[12px] leading-[17px] text-ink-muted">{{
          state.look().note
        }}</text>

        <view class="pt-4">
          <app-controls />
        </view>

        <text class="px-3 pt-5 text-[11px] leading-[16px] text-ink-muted">{{
          credit()
        }}</text>
      </view>
    </scroll-view>
  `,
})
export class App {
  protected readonly state = inject(DarkroomState);
  readonly #picker = inject(LynxImagePicker);
  readonly #share = inject(LynxShare);
  readonly enlargement = viewChild.required<Enlargement>('enlargement');

  protected readonly printing = signal(false);
  protected readonly note = signal('');
  #noteTimer: ReturnType<typeof setTimeout> | undefined;
  #picked = 0;

  protected readonly frameNumber = computed(
    () =>
      this.state
        .roll()
        .findIndex((photo) => photo.id === this.state.photoId()) + 1,
  );

  protected readonly credit = computed(() => {
    const photo = this.state.photo();
    return photo.source
      ? `Photo: ${photo.title}, by ${photo.author}. CC0, from Wikimedia Commons.`
      : `Photo: ${photo.title}, from your library. It stays on this device.`;
  });

  /**
   * Picks a photo from the phone's library and puts it on the easel.
   */
  protected async load(): Promise<void> {
    try {
      // Scaled down: a 12-megapixel original would cross the bridge as
      // megabytes of text, and the sheet shows it at a few hundred pixels.
      const picked = await this.#picker.pick({
        maxDimension: 2048,
        quality: 0.9,
      });
      if (!picked) return;
      const src = URL.createObjectURL(picked.blob);
      const { width, height } = await loadImage(src);
      this.state.addPicked({
        id: `picked-${++this.#picked}`,
        src,
        width,
        height,
        title: picked.name,
        author: 'you',
        source: '',
        look: 'harbor',
      });
      this.#say('loaded');
    } catch (error) {
      this.#say(
        error instanceof ImagePickerError && error.code === 'unavailable'
          ? 'no photo picker here'
          : "couldn't load it",
      );
    }
  }

  protected keep(): void {
    const recipe = this.state.keepRecipe();
    this.#say(`kept as ${recipe.name.toLowerCase()}`);
  }

  /**
   * Prints: the photo developed at its own full size, as a JPEG, handed to
   * the phone's share sheet, where it can be saved to Photos or sent on.
   */
  protected async print(): Promise<void> {
    if (this.printing()) return;
    this.printing.set(true);
    try {
      const blob = await this.enlargement().print();
      if (!blob) {
        this.#say('no canvas to print from');
        return;
      }
      const photo = this.state.photo();
      const shared = await this.#share.share({
        files: [{ blob, name: `darkroom-${photo.id}.jpg` }],
        title: photo.title,
      });
      if (shared) this.#say('printed');
    } catch (error) {
      this.#say(
        error instanceof ShareError && error.code === 'unavailable'
          ? 'no share sheet here'
          : "couldn't print",
      );
    } finally {
      this.printing.set(false);
    }
  }

  #say(note: string): void {
    clearTimeout(this.#noteTimer);
    this.note.set(note);
    this.#noteTimer = setTimeout(() => this.note.set(''), NOTE_MS);
  }
}
