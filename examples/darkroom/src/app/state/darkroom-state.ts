import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { LynxLocalStorage } from '@blotch/angular-lynx';
import { type Look, LOOKS, lookById } from '../develop/looks';
import { type Photo, ROLL } from '../develop/photos';
import {
  type AdjustmentKey,
  type Development,
  NEUTRAL,
  readDevelopment,
} from '../develop/settings';

/** A recipe the person kept, to print other photos with. */
export type Recipe = Development & {
  readonly id: string;
  readonly name: string;
};

type Saved = {
  readonly photoId: string;
  readonly developments: Record<string, Development>;
  readonly recipes: readonly Recipe[];
};

const KEY = 'darkroom.v1';

/**
 * The darkroom's state, shared by every part of the screen and kept on the
 * device: which photo is on the easel, how each photo of the roll is being
 * developed, and the recipes kept to reuse.
 *
 * A photo the person picks lives for the session only: its bytes are
 * megabytes, too many for key-value storage, and the photo is still in their
 * library to pick again.
 */
@Injectable({ providedIn: 'root' })
export class DarkroomState {
  readonly #storage = inject(LynxLocalStorage);

  readonly looks = LOOKS;

  /** The bundled roll, then any photos picked this session, newest first. */
  readonly #picked = signal<readonly Photo[]>([]);
  readonly roll = computed(() => [...this.#picked(), ...ROLL]);

  readonly photoId = signal(ROLL[0]!.id);
  readonly photo = computed(
    () => this.roll().find((photo) => photo.id === this.photoId()) ?? ROLL[0]!,
  );

  readonly #developments = signal<Record<string, Development>>({});
  /** The current photo's development: its saved one, or its roll's look. */
  readonly development = computed<Development>(
    () =>
      this.#developments()[this.photoId()] ?? {
        look: this.photo().look,
        adjustments: NEUTRAL,
      },
  );
  readonly look = computed<Look>(() => lookById(this.development().look));
  readonly adjustments = computed(() => this.development().adjustments);

  /** Whether this photo has been touched since it came out of the box. */
  readonly edited = computed(() => {
    const { adjustments, look } = this.development();
    return (
      look !== this.photo().look ||
      Object.values(adjustments).some((value) => value !== 0)
    );
  });

  readonly recipes = signal<readonly Recipe[]>([]);

  /**
   * Whether a photo of the roll has been worked on, for the strip's ticks.
   */
  isEdited(photo: Photo): boolean {
    const development = this.#developments()[photo.id];
    if (!development) return false;
    return (
      development.look !== photo.look ||
      Object.values(development.adjustments).some((value) => value !== 0)
    );
  }

  readonly #restored = signal(false);

  constructor() {
    this.#restore();
    // Persist each change once the saved state has been read: writing before
    // that would overwrite the last session with the defaults. Picked photos
    // aren't kept, so neither are their developments.
    effect(() => {
      const picked = new Set(this.#picked().map((photo) => photo.id));
      const developments = Object.fromEntries(
        Object.entries(this.#developments()).filter(([id]) => !picked.has(id)),
      );
      const saved: Saved = {
        photoId: picked.has(this.photoId()) ? ROLL[0]!.id : this.photoId(),
        developments,
        recipes: this.recipes(),
      };
      if (!this.#restored()) return;
      this.#storage.setItem(KEY, saved).catch(() => {});
    });
  }

  select(photo: Photo): void {
    this.photoId.set(photo.id);
  }

  setLook(look: Look): void {
    this.#update({ ...this.development(), look: look.id });
  }

  adjust(key: AdjustmentKey, value: number): void {
    const development = this.development();
    if (development.adjustments[key] === value) return;
    this.#update({
      ...development,
      adjustments: { ...development.adjustments, [key]: value },
    });
  }

  /**
   * Back to the roll's own look, with nothing adjusted.
   */
  reset(): void {
    const id = this.photoId();
    this.#developments.update((all) => {
      const { [id]: _removed, ...rest } = all;
      return rest;
    });
  }

  /**
   * Adds a photo the person picked, and puts it on the easel.
   */
  addPicked(photo: Photo): void {
    this.#picked.update((picked) => [photo, ...picked]);
    this.photoId.set(photo.id);
  }

  /**
   * Keeps the current development as a recipe, named after its look.
   */
  keepRecipe(): Recipe {
    const { look, adjustments } = this.development();
    const count = this.recipes().filter(
      (recipe) => recipe.look === look,
    ).length;
    const recipe: Recipe = {
      id: `r${Date.now().toString(36)}`,
      name: `${lookById(look).name} ${String(count + 1).padStart(2, '0')}`,
      look,
      adjustments,
    };
    this.recipes.update((recipes) => [recipe, ...recipes]);
    return recipe;
  }

  applyRecipe(recipe: Recipe): void {
    this.#update({ look: recipe.look, adjustments: recipe.adjustments });
  }

  removeRecipe(recipe: Recipe): void {
    this.recipes.update((recipes) => recipes.filter((r) => r !== recipe));
  }

  #update(development: Development): void {
    const id = this.photoId();
    this.#developments.update((all) => ({ ...all, [id]: development }));
  }

  async #restore(): Promise<void> {
    try {
      const saved = await this.#storage.getItem<Saved>(KEY);
      if (saved) {
        if (ROLL.some((photo) => photo.id === saved.photoId)) {
          this.photoId.set(saved.photoId);
        }
        const developments: Record<string, Development> = {};
        for (const [id, value] of Object.entries(saved.developments ?? {})) {
          const development = readDevelopment(value);
          if (development) developments[id] = development;
        }
        this.#developments.set(developments);
        const recipes: Recipe[] = [];
        for (const value of saved.recipes ?? []) {
          const development = readDevelopment(value);
          if (development && typeof value.id === 'string') {
            recipes.push({ ...development, id: value.id, name: value.name });
          }
        }
        this.recipes.set(recipes);
      }
    } catch {
      // Nothing saved, or storage isn't there (a test): start fresh.
    }
    this.#restored.set(true);
  }
}
