/**
 * Angular directive stubs for every Lynx native element.
 *
 * Import LYNX_ELEMENTS into any component that uses Lynx elements in its template
 * for IDE autocomplete and zero red squiggles:
 *
 *   @Component({
 *     imports: [LYNX_ELEMENTS],
 *     template: `<view><text>Hello</text></view>`,
 *   })
 *   export class My {}
 *
 * The rsbuild plugin automatically injects CUSTOM_ELEMENTS_SCHEMA at build time
 * so the build always succeeds even without importing LYNX_ELEMENTS. These stubs
 * are purely for IDE ergonomics.
 *
 * Implementation notes:
 * - These are @Directive, NOT @Component. Using @Component causes Angular to treat
 *   the element's children as projected content. Any directive inside projected
 *   content that injects ViewContainerRef (e.g. RouterOutlet) crashes at runtime
 *   because insertAnchorNode calls renderer.insertBefore(null, anchor) — the parent
 *   is not yet resolved while Angular is collecting projected nodes. @Directive has
 *   no template, so children are direct element children as expected — identical
 *   rendering behavior to not importing LYNX_ELEMENTS at all.
 * - Properties use their Lynx attribute name (kebab-case) so IDE hover shows the
 *   exact attribute to use in templates (e.g. 'scroll-orientation').
 * - Properties are declared as inputs (via @Directive({ inputs: [...] })) so
 *   Angular's template checker accepts property bindings like [src]="url".
 *   Angular intercepts these bindings and sets them on the directive instance.
 *   LynxElementBase.ngOnChanges forwards every input change to the native Lynx
 *   element via BaseLynxElement.setAttribute() → __SetAttribute().
 * - Events (bindtap, catchtap, bindinput, bindscroll, …) are NOT declared as
 *   @Output() because Angular would intercept them and skip the renderer's
 *   listen() call, breaking native Lynx event delivery. They continue to work
 *   via renderer.listen() which handles all unrecognized event names.
 */
export { LynxElementBase } from './base';
export {
  LYNX_FORM_ACCESSORS,
  LynxInputValueAccessor,
  LynxTextareaValueAccessor,
} from '../forms';
export { LynxFrame } from './frame';
export { LynxImage } from './image';
export { LynxInput, LynxTextarea } from './input';
export { LynxList, LynxListItem } from './list';
export { LynxBlock, LynxFor, LynxIf } from './misc';
export { LynxOverlay } from './overlay';
export { LynxRefresh, LynxRefreshHeader } from './refresh';
export {
  LynxScrollCoordinator,
  LynxScrollCoordinatorHeader,
  LynxScrollCoordinatorSlot,
  LynxScrollCoordinatorToolbar,
} from './scroll-coordinator';
export { LynxScrollView } from './scroll-view';
export { LynxSvg } from './svg';
export { LynxText } from './text';
export { LynxView } from './view';
export { LynxViewPager, LynxViewPagerItem } from './viewpager';

import { LYNX_FORM_ACCESSORS } from '../forms';
import { LynxFrame } from './frame';
import { LynxImage } from './image';
import { LynxInput, LynxTextarea } from './input';
import { LynxList, LynxListItem } from './list';
import { LynxBlock, LynxFor, LynxIf } from './misc';
import { LynxOverlay } from './overlay';
import { LynxRefresh, LynxRefreshHeader } from './refresh';
import {
  LynxScrollCoordinator,
  LynxScrollCoordinatorHeader,
  LynxScrollCoordinatorSlot,
  LynxScrollCoordinatorToolbar,
} from './scroll-coordinator';
import { LynxScrollView } from './scroll-view';
import { LynxSvg } from './svg';
import { LynxText } from './text';
import { LynxView } from './view';
import { LynxViewPager, LynxViewPagerItem } from './viewpager';

/**
 * All Lynx native element directives as a single importable array.
 * Add to the `imports` of any component whose template uses Lynx elements.
 */
export const LYNX_ELEMENTS = [
  LynxView,
  LynxText,
  LynxImage,
  LynxScrollView,
  LynxList,
  LynxListItem,
  LynxBlock,
  LynxIf,
  LynxFor,
  LynxFrame,
  LynxInput,
  LynxTextarea,
  // CVA directives — activate on top of LynxInput/LynxTextarea when form attributes
  // (formControl, formControlName, ngModel, formField) are present on the element.
  ...LYNX_FORM_ACCESSORS,
  LynxOverlay,
  LynxRefresh,
  LynxRefreshHeader,
  LynxScrollCoordinator,
  LynxScrollCoordinatorHeader,
  LynxScrollCoordinatorSlot,
  LynxScrollCoordinatorToolbar,
  LynxSvg,
  LynxViewPager,
  LynxViewPagerItem,
] as const;
