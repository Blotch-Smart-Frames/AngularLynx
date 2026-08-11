import { Component, ViewEncapsulation, computed, input } from '@angular/core';

import { cn } from '../../utils/cn';

@Component({
  selector: 'ui-separator',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  // The styling lives on the HOST element, not an inner <view>, so the separator
  // is a single element (like shadcn's separator on the web). This is essential:
  // an Angular component host whose selector is not a native Lynx element falls
  // back to a plain, UNSTYLED `view` (see runtime CLAUDE.md). If we styled an
  // inner <view> instead, that unstyled host would sit between the parent and the
  // line as an extra flex item — and a zero-content separator has no intrinsic
  // size to give the host, so the host collapses and the line disappears.
  //
  // This is exactly why the vertical separator was invisible: in a `flex flex-row
  // items-center` parent, `items-center` overrides Lynx's default `align-items:
  // stretch`, so the unstyled host collapsed to 0 height and the inner view had
  // nothing to fill. (The horizontal one survived only because a `flex-col`
  // parent stretches the host to full width by default.) Styling the host makes
  // the sizing classes apply to the actual flex item of the parent row.
  host: {
    '[class]': 'separatorClass()',
  },
  template: '',
})
export class UiSeparator {
  readonly orientation = input<'horizontal' | 'vertical'>('horizontal');
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly separatorClass = computed(() =>
    cn(
      'bg-border',
      // Horizontal: 1px tall, `w-full` to span the parent's width.
      // Vertical: 1px wide, `self-stretch` (align-self: stretch) to fill the
      // parent row's height. We use align-self rather than `h-full` because a
      // percentage height does not reliably resolve on a flex item in Lynx,
      // whereas align-self stretches to the parent's cross axis directly — and
      // it re-enables stretch even when the parent set `align-items: center`.
      this.orientation() === 'horizontal' ? 'h-px w-full' : 'w-px self-stretch',
      this.userClass(),
    ),
  );
}
