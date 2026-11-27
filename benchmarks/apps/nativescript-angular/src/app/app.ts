import { Component, NO_ERRORS_SCHEMA } from '@angular/core';
import { PageRouterOutlet } from '@nativescript/angular';

/** The reference's root _layout: a native stack (UINavigationController), the tabs its first page. */
@Component({
  selector: 'app-root',
  imports: [PageRouterOutlet],
  schemas: [NO_ERRORS_SCHEMA],
  template: `<page-router-outlet />`,
})
export class App {}
