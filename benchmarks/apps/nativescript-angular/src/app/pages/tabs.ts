import { Component, NO_ERRORS_SCHEMA, inject, signal } from '@angular/core';
import { NativeScriptCommonModule } from '@nativescript/angular';
import { Color, Page, type EventData, type SelectedIndexChangedEventData, type TabView } from '@nativescript/core';
import { FavouritesPage } from './favourites';
import { Pokedex } from './pokedex';

/**
 * The reference's (tabs)/_layout. Its bar is React Navigation's JavaScript tab bar; NativeScript's
 * TabView is the platform's own (UITabBarController on iOS), as Angular Native's is. The icons are
 * the reference's SVGs, in the asset catalog as template images, so the bar tints them: black when
 * selected, #424242 otherwise, with 12pt titles. A tab shows its solid icon while selected.
 */
@Component({
  selector: 'app-tabs',
  imports: [NativeScriptCommonModule, FavouritesPage, Pokedex],
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <TabView
      selectedTabTextColor="#000000"
      tabTextColor="#424242"
      tabTextFontSize="12"
      iosIconRenderingMode="alwaysTemplate"
      (loaded)="tintIcons($event)"
      (selectedIndexChanged)="onSelected($event)"
    >
      <GridLayout
        *tabItem="{ title: 'Pokédex', iconSource: selected() === 0 ? 'res://home_solid' : 'res://home' }"
      >
        <app-pokedex />
      </GridLayout>
      <GridLayout
        *tabItem="{ title: 'Favourites', iconSource: selected() === 1 ? 'res://heart_solid' : 'res://heart' }"
      >
        <app-favourites />
      </GridLayout>
    </TabView>
  `,
})
export class Tabs {
  protected readonly selected = signal(0);

  constructor() {
    // The reference's screens are white under the status bar, so dark content always, and no
    // navigation bar: the tabs are the stack's first page.
    const page = inject(Page);
    page.actionBarHidden = true;
    page.statusBarStyle = 'dark';
    page.backgroundColor = new Color('#ffffff');
  }

  /**
   * TabView sets the titles' colors through the bar's appearance and the selected tint through
   * `tintColor`, but leaves an unselected icon the system's grey: the reference's is #424242.
   */
  protected onSelected(event: Event): void {
    // NativeScript's events aren't DOM events, whatever the template's type checking says.
    this.selected.set((event as unknown as SelectedIndexChangedEventData).newIndex);
  }

  protected tintIcons(event: Event): void {
    const tabBar = ((event as unknown as EventData).object as TabView).ios?.tabBar as UITabBar | undefined;
    if (!tabBar) return;
    const appearance = tabBar.standardAppearance;
    for (const layout of [
      appearance.stackedLayoutAppearance,
      appearance.inlineLayoutAppearance,
      appearance.compactInlineLayoutAppearance,
    ]) {
      layout.normal.iconColor = new Color('#424242').ios;
      layout.selected.iconColor = new Color('#000000').ios;
    }
    tabBar.standardAppearance = appearance;
    tabBar.scrollEdgeAppearance = appearance;
  }
}
