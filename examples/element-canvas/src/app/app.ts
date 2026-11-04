// cspell:words metalness
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

/**
 * A three.js scene in a <canvas>: lit, with soft shadows, spinning on its own
 * and faster when dragged. On iOS and Android the canvas draws with the
 * shell's OpenGL ES; in the web preview, with the browser's WebGL2.
 */
@Component({
  selector: 'app-root',
  template: `
    <scroll-view class="h-full bg-zinc-50" scroll-orientation="vertical">
      <view class="p-6">
        <text class="mb-1 text-[28px] font-bold text-zinc-900">
          Canvas Element
        </text>
        <text class="mb-5 text-[13px] text-zinc-500">
          A three.js scene drawn with WebGL2. Drag it to spin it.
        </text>

        <view
          class="rounded-xl border border-zinc-200 bg-white overflow-hidden"
        >
          <canvas
            #scene
            class="h-[320px] w-full"
            accessibility-label="A spinning knot"
            (pointerdown)="grab($event)"
            (pointermove)="drag($event)"
            (pointerup)="release()"
            (pointercancel)="release()"
          ></canvas>
          <view class="p-4">
            <text class="text-[13px] leading-[18px] text-zinc-500">
              {{ status() }}
            </text>
          </view>
        </view>
      </view>
    </scroll-view>
  `,
  imports: [LYNX_ELEMENTS],
})
export class App {
  readonly scene = viewChild.required<ElementRef<LynxCanvasElement>>('scene');
  readonly status = signal('Starting WebGL…');

  #spin = 0.6;
  #lastX: number | null = null;

  constructor() {
    const destroyRef = inject(DestroyRef);
    // The canvas has a size once it's laid out, after the first render.
    afterNextRender(() => {
      const stop = this.#start();
      destroyRef.onDestroy(stop);
    });
  }

  grab(event: PointerEvent): void {
    this.#lastX = event.offsetX;
  }

  drag(event: PointerEvent): void {
    if (this.#lastX === null) return;
    this.#spin += (event.offsetX - this.#lastX) * 0.05;
    this.#lastX = event.offsetX;
  }

  release(): void {
    this.#lastX = null;
  }

  #start(): () => void {
    const canvas = this.scene().nativeElement;
    // three.js takes the canvas as it would an HTMLCanvasElement.
    const domCanvas = canvas as unknown as HTMLCanvasElement;
    // getContext('webgl2') is null where there's no WebGL: Lynx Explorer has
    // no canvas, only apps built with `ng build --platform ios|android` do.
    if (!canvas.getContext('webgl2')) {
      this.status.set(
        'No WebGL here: open this in the web preview, or in an app built with ng build --platform ios|android.',
      );
      return () => {};
    }
    const renderer = new THREE.WebGLRenderer({
      canvas: domCanvas,
      antialias: true,
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1f2233);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
    camera.position.set(0, 2.6, 7.5);
    camera.lookAt(0, 0.8, 0);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(3, 6, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    scene.add(sun);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(3.2, 64),
      new THREE.MeshStandardMaterial({ color: 0x3b4262, roughness: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const knot = new THREE.Mesh(
      new THREE.TorusKnotGeometry(0.75, 0.26, 160, 24),
      new THREE.MeshStandardMaterial({
        color: 0x6366f1,
        roughness: 0.35,
        metalness: 0.2,
      }),
    );
    knot.position.y = 1.4;
    knot.castShadow = true;
    scene.add(knot);

    // The canvas's size is its layout's: the drawing buffer follows it.
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
      // A drag speeds the spin up, and it settles back.
      this.#spin += (0.6 - this.#spin) * Math.min(1, delta * 1.5);
      knot.rotation.y += delta * this.#spin;
      knot.rotation.x += delta * 0.3;
      renderer.render(scene, camera);
    });
    this.status.set('Drag the knot to spin it faster.');

    return () => {
      renderer.setAnimationLoop(null);
      resize.disconnect();
      renderer.dispose();
    };
  }
}
