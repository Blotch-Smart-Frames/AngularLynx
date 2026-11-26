import {
  afterNextRender,
  Component,
  DestroyRef,
  type ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { LYNX_ELEMENTS, type LynxCanvasElement } from '@blotch/angular-lynx';
import * as THREE from 'three';

const SALES = [
  { month: 'Jan', value: 42 },
  { month: 'Feb', value: 58 },
  { month: 'Mar', value: 35 },
  { month: 'Apr', value: 71 },
  { month: 'May', value: 64 },
  { month: 'Jun', value: 88 },
];

/**
 * `<canvas>` with a 2D context: a chart drawn with gradients, rounded bars
 * and text, a signature pad that follows the finger, and a three.js cube
 * whose label is drawn on a 2D canvas that's never shown, and uploaded as a
 * texture. On iOS and Android the shell draws with the platform's own 2D
 * graphics; in the web preview, with the browser's canvas.
 */
@Component({
  selector: 'app-root',
  template: `
    <scroll-view class="h-full bg-zinc-50" scroll-orientation="vertical">
      <view
        class="px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-[calc(1.5rem+env(safe-area-inset-top))]"
      >
        <text class="mb-1 text-[28px] font-bold text-zinc-900">
          Canvas 2D
        </text>
        <text class="mb-5 text-[13px] text-zinc-500">
          getContext('2d'): paths, gradients, text and images.
        </text>

        <text class="mb-2 text-[15px] font-semibold text-zinc-900">Chart</text>
        <view
          class="mb-6 rounded-xl border border-zinc-200 bg-white overflow-hidden"
        >
          <canvas
            #chart
            class="h-[220px] w-full"
            accessibility-label="Monthly sales chart"
          ></canvas>
        </view>

        <view class="mb-2 flex-row items-center flex justify-between">
          <text class="text-[15px] font-semibold text-zinc-900">Signature</text>
          <view class="flex-row flex">
            <text
              class="mr-4 text-[15px] text-indigo-600"
              accessibility-label="Clear signature"
              (bindtap)="clearSignature()"
              >Clear</text
            >
            <text
              class="text-[15px] text-indigo-600"
              accessibility-label="Save signature"
              (bindtap)="saveSignature()"
              >Save</text
            >
          </view>
        </view>
        <view
          class="mb-3 rounded-xl border border-zinc-200 bg-white overflow-hidden"
        >
          <canvas
            #signature
            class="h-[180px] w-full"
            accessibility-label="Signature pad"
            [consume-slide-event]="[[-180, 180]]"
            (pointerdown)="startStroke($event)"
            (pointermove)="continueStroke($event)"
            (pointerup)="endStroke()"
            (pointercancel)="endStroke()"
            (lostpointercapture)="endStroke()"
          ></canvas>
        </view>
        @if (saved(); as image) {
          <view class="mb-6 flex-row items-center flex">
            <text class="mr-3 text-[13px] text-zinc-500">Saved as PNG:</text>
            <image
              class="h-[45px] w-[120px] rounded-md border border-zinc-200"
              [src]="image"
              accessibility-label="Saved signature"
            ></image>
          </view>
        } @else {
          <text class="mb-6 text-[13px] text-zinc-500">
            Sign above, then Save.
          </text>
        }

        <text class="mb-2 text-[15px] font-semibold text-zinc-900">
          A 2D canvas as a texture
        </text>
        <view
          class="mb-3 rounded-xl border border-zinc-200 bg-white overflow-hidden"
        >
          <canvas
            #scene
            class="h-[220px] w-full"
            accessibility-label="A cube with a label"
          ></canvas>
        </view>
        <text class="text-[13px] leading-[18px] text-zinc-500">
          {{ status() }}
        </text>
      </view>
    </scroll-view>
  `,
  imports: [LYNX_ELEMENTS],
})
export class App {
  readonly chart = viewChild.required<ElementRef<LynxCanvasElement>>('chart');
  readonly signature =
    viewChild.required<ElementRef<LynxCanvasElement>>('signature');
  readonly scene = viewChild.required<ElementRef<LynxCanvasElement>>('scene');
  readonly status = signal('Starting…');
  readonly saved = signal<string | null>(null);

  #pad: CanvasRenderingContext2D | null = null;
  #last: { x: number; y: number } | null = null;

  constructor() {
    const destroyRef = inject(DestroyRef);
    // A canvas has a size once it's laid out, after the first render.
    afterNextRender(() => {
      const stops = [
        this.#sizeToLayout(this.chart().nativeElement, (context, w, h) =>
          drawChart(context, w, h),
        ),
        this.#sizeToLayout(this.signature().nativeElement, (context) => {
          this.#pad = context;
          context.lineCap = 'round';
          context.lineJoin = 'round';
          context.lineWidth = 3;
          context.strokeStyle = '#312e81';
        }),
        this.#startScene(),
      ];
      destroyRef.onDestroy(() => stops.forEach((stop) => stop()));
    });
  }

  /**
   * Sizes the canvas's bitmap to its laid-out size at the screen's
   * resolution, and draws in its CSS pixels, as on the web.
   */
  #sizeToLayout(
    canvas: LynxCanvasElement,
    draw: (
      context: CanvasRenderingContext2D,
      width: number,
      height: number,
    ) => void,
  ): () => void {
    const context = canvas.getContext('2d') as CanvasRenderingContext2D | null;
    if (!context) {
      this.status.set(
        'No 2D canvas here: open this in the web preview, or in an app built with ng build --platform ios|android.',
      );
      return () => {};
    }
    const target = canvas as unknown as HTMLCanvasElement;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (!width || !height) return;
      const ratio = devicePixelRatio;
      // Setting the size clears the canvas and its state.
      target.width = Math.round(width * ratio);
      target.height = Math.round(height * ratio);
      context.scale(ratio, ratio);
      draw(context, width, height);
    });
    observer.observe(target);
    return () => observer.disconnect();
  }

  startStroke(event: PointerEvent): void {
    // The stroke follows the pointer even when it leaves the pad.
    this.signature().nativeElement.setPointerCapture(event.pointerId);
    this.#last = { x: event.offsetX, y: event.offsetY };
  }

  continueStroke(event: PointerEvent): void {
    const pad = this.#pad;
    if (!pad || !this.#last) return;
    pad.beginPath();
    pad.moveTo(this.#last.x, this.#last.y);
    pad.lineTo(event.offsetX, event.offsetY);
    pad.stroke();
    this.#last = { x: event.offsetX, y: event.offsetY };
  }

  endStroke(): void {
    this.#last = null;
  }

  clearSignature(): void {
    const pad = this.#pad;
    if (!pad) return;
    pad.save();
    pad.setTransform(1, 0, 0, 1, 0, 0);
    pad.clearRect(0, 0, pad.canvas.width, pad.canvas.height);
    pad.restore();
    this.saved.set(null);
  }

  saveSignature(): void {
    const canvas = this.#pad?.canvas;
    if (canvas) this.saved.set(canvas.toDataURL('image/png'));
  }

  #startScene(): () => void {
    const canvas = this.scene().nativeElement;
    const domCanvas = canvas as unknown as HTMLCanvasElement;
    if (!canvas.getContext('webgl2')) return () => {};

    // The label is drawn on a canvas that's never in the page, as three.js
    // apps draw text, and uploaded as the cube's texture.
    const label = document.createElement('canvas');
    label.width = 256;
    label.height = 256;
    const context = label.getContext('2d');
    if (!context) return () => {};
    const gradient = context.createLinearGradient(0, 0, 256, 256);
    gradient.addColorStop(0, '#6366f1');
    gradient.addColorStop(1, '#ec4899');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 256);
    context.fillStyle = 'white';
    context.font = 'bold 64px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('Lynx', 128, 112);
    context.font = '28px sans-serif';
    context.fillText('2D → WebGL', 128, 176);

    const renderer = new THREE.WebGLRenderer({
      canvas: domCanvas,
      antialias: true,
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1f2233);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
    camera.position.set(0, 0, 4.2);
    const texture = new THREE.CanvasTexture(label);
    texture.colorSpace = THREE.SRGBColorSpace;
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 1.6, 1.6),
      new THREE.MeshBasicMaterial({ map: texture }),
    );
    scene.add(cube);

    const resize = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });
    resize.observe(domCanvas);

    const clock = new THREE.Clock();
    renderer.setAnimationLoop(() => {
      const delta = clock.getDelta();
      cube.rotation.y += delta * 0.7;
      cube.rotation.x += delta * 0.25;
      renderer.render(scene, camera);
    });

    // A check of what the context answers, shown under the scene.
    const probe = document.createElement('canvas');
    probe.width = 4;
    probe.height = 4;
    const probeContext = probe.getContext('2d');
    if (probeContext) {
      probeContext.fillStyle = 'rgb(255, 0, 0)';
      probeContext.fillRect(0, 0, 4, 4);
      const [r, g, b, a] = probeContext.getImageData(1, 1, 1, 1).data;
      const width = Math.round(context.measureText('Lynx').width);
      this.status.set(
        `Pixel (${r}, ${g}, ${b}, ${a}); "Lynx" is ${width}px wide at 28px.`,
      );
    }

    return () => {
      renderer.setAnimationLoop(null);
      resize.disconnect();
      texture.dispose();
      renderer.dispose();
    };
  }
}

/**
 * A bar chart: a dashed grid, gradient bars with rounded tops, labels.
 */
const drawChart = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): void => {
  const left = 36;
  const bottom = height - 28;
  const top = 16;
  const right = width - 12;
  const max = 100;

  context.clearRect(0, 0, width, height);
  context.font = '11px sans-serif';
  context.fillStyle = '#71717a';
  context.textAlign = 'right';
  context.textBaseline = 'middle';
  context.strokeStyle = '#e4e4e7';
  context.lineWidth = 1;
  context.setLineDash([4, 4]);
  for (let value = 0; value <= max; value += 25) {
    const y = bottom - ((bottom - top) * value) / max;
    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(right, y);
    context.stroke();
    context.fillText(String(value), left - 8, y);
  }
  context.setLineDash([]);

  const slot = (right - left) / SALES.length;
  const barWidth = slot * 0.56;
  const gradient = context.createLinearGradient(0, top, 0, bottom);
  gradient.addColorStop(0, '#818cf8');
  gradient.addColorStop(1, '#4338ca');
  context.textAlign = 'center';
  SALES.forEach(({ month, value }, index) => {
    const x = left + slot * index + (slot - barWidth) / 2;
    const y = bottom - ((bottom - top) * value) / max;
    context.save();
    context.shadowColor = 'rgba(67, 56, 202, 0.35)';
    context.shadowBlur = 8;
    context.shadowOffsetY = 3;
    context.fillStyle = gradient;
    context.beginPath();
    context.roundRect(x, y, barWidth, bottom - y, [6, 6, 0, 0]);
    context.fill();
    context.restore();
    context.fillStyle = '#18181b';
    context.textBaseline = 'bottom';
    context.fillText(String(value), x + barWidth / 2, y - 4);
    context.fillStyle = '#71717a';
    context.textBaseline = 'top';
    context.fillText(month, x + barWidth / 2, bottom + 8);
  });

  // A trend line over the bars, through each bar's top.
  context.strokeStyle = '#ec4899';
  context.lineWidth = 2;
  context.beginPath();
  SALES.forEach(({ value }, index) => {
    const x = left + slot * index + slot / 2;
    const y = bottom - ((bottom - top) * value) / max;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
  context.fillStyle = '#ec4899';
  SALES.forEach(({ value }, index) => {
    const x = left + slot * index + slot / 2;
    const y = bottom - ((bottom - top) * value) / max;
    context.beginPath();
    context.arc(x, y, 3.5, 0, Math.PI * 2);
    context.fill();
  });
};
