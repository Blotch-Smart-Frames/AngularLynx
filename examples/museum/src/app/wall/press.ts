import { Directive, signal } from '@angular/core';

/**
 * Lights a pane while a finger is on it: the `pressed` class, which
 * styles.css turns into brighter glass. Lynx builds don't apply `:active`,
 * so the state comes from the touch events, and from the mouse in the web
 * preview, where a desktop browser sends no touches.
 */
@Directive({
  selector: '[appPress]',
  host: {
    '[class.pressed]': 'pressed()',
    '(bindtouchstart)': 'pressed.set(true)',
    '(bindtouchend)': 'pressed.set(false)',
    '(bindtouchcancel)': 'pressed.set(false)',
    '(bindmousedown)': 'pressed.set(true)',
    '(bindmouseup)': 'pressed.set(false)',
    '(bindmouseleave)': 'pressed.set(false)',
  },
})
export class Press {
  readonly pressed = signal(false);
}
