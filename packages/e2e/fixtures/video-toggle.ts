import {
  Component,
  computed,
  type ElementRef,
  signal,
  viewChild,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { environment } from '../environments/environment';

/** What each read is of: the video as it's shown or hidden, in that order. */
const STEPS = ['shown', 'hidden', 'shown again', 'hidden again'] as const;

/**
 * How long a toggle is given to reach the native view before the video is
 * read. The style reaches the view at Lynx's next layout, and Android's
 * VideoUI moves the player in a post after SurfaceView's callbacks: a read
 * before then is of the surface the toggle is taking away (or hasn't made
 * yet), which would pass without the move being tried.
 */
const SETTLE_MS = 1000;

/**
 * How many times a read is tried, 100 ms apart, once the toggle has
 * settled: the player draws a frame on its new surface only after the move,
 * and the video has nothing to read until that frame is there.
 */
const READ_TRIES = 50;

/**
 * A video pixel's color by name: a video's colors are near, not exact,
 * after its YUV encoding (as in canvas.ts).
 */
const colorName = ({ 0: r, 1: g, 2: b }: ArrayLike<number>): string =>
  r > 180 && g < 80 && b < 80
    ? 'red'
    : b > 180 && r < 80 && g < 80
      ? 'blue'
      : `${r} ${g} ${b}`;

/**
 * E2E fixture for a `<video>` switched between shown and `display: none`
 * (issue #791), loaded through `loadComponent` like photo.ts, which links
 * here. canvas.ts reads one video that's always shown and one that's always
 * hidden; this one reads the same video as it goes from one to the other.
 *
 * On Android, VideoUI moves the player between the view's SurfaceView and
 * its own VideoFrameTarget each time the view's surface comes or goes
 * (issue #726), and that move is what this checks: a video shown, then
 * hidden, then shown and hidden again has to read the same frame each time.
 * A regression there is silent: the video reads nothing on a canvas, and its
 * `videoWidth` drops to 0, with no error. media3's own callback nulling the
 * player's output on the second hide was one (#790).
 *
 * The video is fixtures/video.mp4, as on the canvas page: 32 by 64 once its
 * track's transform turns it, red above and blue below. It stays paused, so
 * every read is of its first frame. Once that frame shows, the page reads
 * it (its size, and its colors at the top and the bottom, drawn on a 2D
 * canvas), then hides it, reads it, shows it, reads it, hides it and reads
 * it again. Each toggle waits SETTLE_MS for the view to change, then tries
 * the read until the video has a frame, so a video that never gets one
 * again reads "no frame" rather than leaving the line unfinished.
 *
 * The line is "Video toggled: 32x64 red,blue" once all four reads agree, or
 * each read by its step when they don't.
 */
@Component({
  selector: 'app-video-toggle',
  imports: [LYNX_ELEMENTS],
  template: `
    <video
      #video
      [src]="videoUrl"
      [muted]="true"
      style="width: 20px; height: 40px; margin-top: 16px;"
      [style.display]="hidden() ? 'none' : 'flex'"
      (bindfirstframe)="start()"
      (binderror)="reads.set(['error'])"
    ></video>
    <text flatten="false" style="margin-top: 8px;"
      >Video toggled: {{ result() }}</text
    >
  `,
})
export class VideoToggleRoute {
  readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  readonly videoUrl = environment.videoUrl;
  /** Whether the video has `display: none`. */
  readonly hidden = signal(false);
  /** Each step's read, in STEPS' order. */
  readonly reads = signal<string[]>([]);
  #started = false;

  /**
   * One read when every step's agrees, or each step's when they don't (or
   * how many are done, while they agree so far).
   */
  readonly result = computed(() => {
    const reads = this.reads();
    const agree = reads.every((read) => read === reads[0]);
    if (agree && reads.length === STEPS.length) return reads[0];
    if (agree) return `… (${reads.length} of ${STEPS.length})`;
    return reads.map((read, index) => `${STEPS[index]} ${read}`).join('; ');
  });

  /**
   * Runs the steps once the first frame shows. A source shown again after
   * `stop` and `play` can send bindfirstframe again, which mustn't start a
   * second run.
   */
  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    for (const [index, step] of STEPS.entries()) {
      const hide = step.startsWith('hidden');
      if (index > 0) {
        this.hidden.set(hide);
        await delay(SETTLE_MS);
      }
      const read = await this.#read();
      this.reads.update((reads) => [...reads, read]);
    }
  }

  /**
   * The video's frame, read once it has one, or "no frame" after READ_TRIES.
   */
  async #read(): Promise<string> {
    for (let tries = READ_TRIES; tries > 0; tries--) {
      try {
        const read = this.#draw();
        if (read !== undefined) return read;
      } catch (error) {
        return `error ${(error as Error).message}`;
      }
      await delay(100);
    }
    return 'no frame';
  }

  /**
   * The video drawn on a 2D canvas: its size, and its colors at the top and
   * the bottom, or undefined while it has no frame.
   */
  #draw(): string | undefined {
    const video = this.video().nativeElement;
    if (video.videoWidth === 0) return undefined;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return 'no 2D';
    context.drawImage(video, 0, 0);
    const middle = Math.floor(canvas.width / 2);
    const top = colorName(context.getImageData(middle, 4, 1, 1).data);
    const bottom = colorName(
      context.getImageData(middle, canvas.height - 4, 1, 1).data,
    );
    return `${canvas.width}x${canvas.height} ${top},${bottom}`;
  }
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
