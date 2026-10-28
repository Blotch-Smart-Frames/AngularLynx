import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  LYNX_ELEMENTS,
  LynxAccessibilitySettings,
  LynxSystemInfo,
} from '@blotch/angular-lynx';
import { injectGlassDesign } from '../components/ui/glass';
import { UiNavigationBar } from '../components/ui/navigation-bar';
import {
  UiBarScroll,
  UiToolbar,
  UiToolbarGroup,
  UiToolbarItem,
  UiToolbarSpacer,
} from '../components/ui/toolbar';
import { NOTES } from './notes';

/**
 * A routed component's host is a real element in the app's column, and
 * arrives unstyled. `flex-1` gives it the column's height, so the scroll-view
 * inside has a height to scroll within instead of growing to fit its content.
 */
const SCREEN_HOST = { class: 'flex-1 flex-col flex' };

/**
 * The first screen: a large title over a list of notes, with actions at both
 * ends of the bar and a toolbar along the bottom.
 */
@Component({
  selector: 'app-notes-screen',
  imports: [
    LYNX_ELEMENTS,
    UiBarScroll,
    UiNavigationBar,
    UiToolbar,
    UiToolbarGroup,
    UiToolbarItem,
    UiToolbarSpacer,
  ],
  host: SCREEN_HOST,
  template: `
    <!-- ui-bar-scroll starts the content below the bar and draws the large
         title at its top; the bar shows the title once it scrolls under. -->
    <scroll-view
      ui-bar-scroll
      scroll-orientation="vertical"
      class="h-full w-full"
    >
      <view class="flex-col gap-3 px-4 pb-4 pt-2 flex">
        <text class="text-sm text-muted-foreground">
          Scroll the notes under the bars. Tap one to open it: its bar has a
          Back button.
        </text>
        <text class="text-xs text-muted-foreground">{{ status() }}</text>
        <text class="text-xs text-muted-foreground"
          >Last action: {{ lastAction() }}</text
        >
        @for (note of notes; track note.id) {
          <view
            class="flex-row items-center gap-3 rounded-2xl bg-secondary p-3 flex"
            [accessibility-element]="true"
            accessibility-traits="button"
            [accessibility-label]="note.title"
            (bindtap)="open(note.id)"
          >
            <view
              class="h-12 w-12 rounded-xl"
              [style.background-image]="note.cover"
            ></view>
            <view class="flex-1 flex-col gap-0.5 flex">
              <text class="text-base font-semibold text-foreground">{{
                note.title
              }}</text>
              <text class="text-sm text-muted-foreground">{{
                note.excerpt
              }}</text>
            </view>
          </view>
        }
      </view>
    </scroll-view>

    <ui-navigation-bar title="Notes" largeTitle>
      <!-- leading puts an item after the Back button, which the first
           screen doesn't have. -->
      <ui-toolbar-item leading label="Edit" (pressed)="did('Edit')" />
      <!-- Grouped items share one glass capsule on iOS 26. -->
      <ui-toolbar-group>
        <ui-toolbar-item
          icon="search"
          label="Search"
          (pressed)="did('Search')"
        />
        <ui-toolbar-item icon="ellipsis" label="More" (pressed)="did('More')" />
      </ui-toolbar-group>
    </ui-navigation-bar>

    <ui-toolbar>
      <ui-toolbar-item
        icon="folder"
        label="Folders"
        (pressed)="did('Folders')"
      />
      <ui-toolbar-spacer />
      <ui-toolbar-item
        icon="pencil"
        label="New note"
        (pressed)="did('New note')"
      />
    </ui-toolbar>
  `,
})
export class NotesScreen {
  protected readonly notes = NOTES;
  protected readonly lastAction = signal('none');

  readonly #router = inject(Router);
  readonly #design = injectGlassDesign();
  readonly #settings = inject(LynxAccessibilitySettings);
  readonly #system = inject(LynxSystemInfo);

  protected readonly status = computed(() => {
    const os = `${this.#system.platform} ${this.#system.osVersion}`.trim();
    return [
      `Design: ${this.#design()} on ${os}`,
      `Reduce Motion: ${this.#settings.reduceMotion() ? 'on' : 'off'}`,
    ].join(' · ');
  });

  protected did(action: string): void {
    this.lastAction.set(action);
  }

  protected open(id: number): void {
    void this.#router.navigate(['/notes', id]);
  }
}

/**
 * A note: a Back button to the list, grouped actions and a prominent Done,
 * over a colorful page that shows the scroll edge effect.
 */
@Component({
  selector: 'app-note-screen',
  imports: [
    LYNX_ELEMENTS,
    UiBarScroll,
    UiNavigationBar,
    UiToolbar,
    UiToolbarGroup,
    UiToolbarItem,
    UiToolbarSpacer,
  ],
  host: SCREEN_HOST,
  template: `
    <scroll-view
      ui-bar-scroll
      scroll-orientation="vertical"
      class="h-full w-full"
    >
      <view class="flex-col gap-4 px-4 pb-4 pt-2 flex">
        <view
          class="h-[220px] rounded-3xl"
          [style.background-image]="note().cover"
        ></view>
        <text class="text-2xl font-bold text-foreground">{{
          note().title
        }}</text>
        <text class="text-xs text-muted-foreground"
          >Last action: {{ lastAction() }}</text
        >
        @for (paragraph of paragraphs; track $index) {
          <text class="text-base leading-6 text-foreground">{{
            paragraph
          }}</text>
        }
        <view
          class="h-[160px] rounded-3xl"
          [style.background-image]="note().cover"
        ></view>
      </view>
    </scroll-view>

    <!-- The Back button shows while there's a screen to go back to, and
         backRoute covers a note the app opened on. -->
    <ui-navigation-bar
      [title]="note().title"
      backLabel="Notes"
      backRoute="/notes"
    >
      <ui-toolbar-group>
        <ui-toolbar-item
          icon="share-2"
          label="Share"
          (pressed)="did('Share')"
        />
        <ui-toolbar-item
          icon="heart"
          label="Favorite"
          (pressed)="did('Favorite')"
        />
      </ui-toolbar-group>
      <ui-toolbar-item label="Done" prominent (pressed)="did('Done')" />
    </ui-navigation-bar>

    <ui-toolbar>
      <ui-toolbar-group>
        <ui-toolbar-item
          icon="list-checks"
          label="Checklist"
          (pressed)="did('Checklist')"
        />
        <ui-toolbar-item
          icon="camera"
          label="Camera"
          (pressed)="did('Camera')"
        />
      </ui-toolbar-group>
      <ui-toolbar-spacer />
      <ui-toolbar-item icon="trash" label="Delete" (pressed)="did('Delete')" />
    </ui-toolbar>
  `,
})
export class NoteScreen {
  protected readonly lastAction = signal('none');

  /** The note the route's `:id` names. */
  protected readonly note = signal(
    NOTES.find(
      (note) =>
        note.id === Number(inject(ActivatedRoute).snapshot.paramMap.get('id')),
    ) ?? NOTES[0],
  ).asReadonly();

  protected readonly paragraphs = Array.from(
    { length: 8 },
    (_, i) =>
      `Paragraph ${i + 1}. Scroll this note and watch the text and the pictures fade as they pass under the bars, so the buttons stay easy to read over them.`,
  );

  protected did(action: string): void {
    this.lastAction.set(action);
  }
}
