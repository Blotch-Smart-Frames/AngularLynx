import { Directive } from '@angular/core';
import { LynxElementBase } from './base';

/**
 * Draggable region of a custom window title bar, like CSS `app-region: drag`
 * (Clay Windows/macOS only).
 */
@Directive({
  selector: 'title-bar-view',
  standalone: true,
  inputs: ['moveable'],
})
export class LynxTitleBarView extends LynxElementBase {
  /**
   * Whether dragging this region moves the window. @default false
   */
  moveable?: boolean;
}
