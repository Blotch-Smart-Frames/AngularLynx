import type { RendererType2 } from '@angular/core';
import { LynxElementBase } from './base';

/**
 * The tags of the directives in LYNX_ELEMENTS that only declare an element's
 * attributes: their inputs give the template checker the attributes Lynx
 * reads and their types, and their ngOnChanges sets each one on the element
 * (see base.ts), which is what the renderer's setProperty does with a binding
 * no directive takes. Not `input` and `textarea`, whose directives show a
 * field's `value` as its text, nor the directives that add something of
 * their own: the forms' value accessors, LynxRouterLinkActive,
 * LynxAccessibilityTraits and `*lynxListFor`. A test keeps it in step with
 * the directives.
 */
export const DECLARATION_ONLY_TAGS: ReadonlySet<string> = new Set([
  'view',
  'text',
  'inline-truncation',
  'image',
  'scroll-view',
  'list',
  'list-item',
  'block',
  'if',
  'for',
  'frame',
  'overlay',
  'refresh',
  'refresh-header',
  'scroll-coordinator',
  'scroll-coordinator-header',
  'scroll-coordinator-slot',
  'scroll-coordinator-slot-drag',
  'scroll-coordinator-toolbar',
  'svg',
  'viewpager',
  'viewpager-item',
  'blur-view',
  'video',
  'webview',
  'cover-view',
  'title-bar-view',
]);

/** What this reads of a directive's definition. */
type DirectiveDefinition = {
  readonly type: unknown;
  selectors: readonly (readonly unknown[])[];
};

/** The components whose directives have been looked at. */
const seen = new WeakSet<object>();

/**
 * Has Angular match none of the declaration-only element directives that
 * `component`'s template can use. The Lynx renderer calls it with each
 * component's definition as it makes the component's renderer, which Angular
 * does before it renders the component's template for the first time.
 *
 * Angular makes a matched directive for every element it creates, with the
 * element injector it needs, its `ElementRef` and the hooks that hand it its
 * inputs. Without them, Lynx's engine thread spends a quarter less time
 * building a screen of 5,000 views, and nearly a third less for images
 * (PrimJS, in the iOS Simulator), for directives that send nothing the
 * renderer wouldn't (#444).
 * Unmatched, they still do their job: the template checker reads them from
 * the package's type declarations, which this doesn't change, so `[src]` on
 * an `<image>` still type-checks as a string. Angular compiles a property
 * binding to the same instruction whether a directive or the element takes
 * it, and gives one no directive takes to the renderer's setProperty, which
 * sets the attribute as ngOnChanges did. The renderer also reads the
 * attributes their inputs transform, `flatten="false"` or a bare
 * `ignore-focus` (see templateAttributeValue in base.ts).
 *
 * A component's definition lists the definitions of the directives its
 * template can match (`directiveDefs`, Angular's own), and a directive's
 * definition is one object for every template that imports it, so emptying
 * its selector list (which then matches nothing, see Angular's
 * isNodeMatchingSelectorList) reaches every template, whatever compiled it.
 * They're found by what they are, a direct subclass of LynxElementBase that
 * selects one of the tags above, rather than listed: a list would keep every
 * one of them in the app's bundle, where Angular keeps only those its
 * templates use. A directive of the app's own that selects `view` still
 * matches.
 *
 * It lasts for the process, whatever renders next. Angular has no matching
 * per renderer: it keeps a component's matches with the component's
 * definition (its TView), for every renderer. So a test that renders on the
 * DOM after one that rendered on Lynx gets none of these directives either.
 */
export const stopMatchingDeclarationOnlyElements = (
  component: RendererType2,
): void => {
  if (seen.has(component)) return;
  seen.add(component);
  const dependencies = (component as { directiveDefs?: unknown }).directiveDefs;
  const definitions = (
    typeof dependencies === 'function' ? dependencies() : dependencies
  ) as readonly (DirectiveDefinition | null)[] | null | undefined;
  if (!definitions) return;
  for (const definition of definitions) {
    if (definition && isDeclarationOnly(definition)) definition.selectors = [];
  }
};

const isDeclarationOnly = ({ type, selectors }: DirectiveDefinition): boolean =>
  selectors.length === 1 &&
  selectors[0].length === 1 &&
  DECLARATION_ONLY_TAGS.has(selectors[0][0] as string) &&
  Object.getPrototypeOf(type) === LynxElementBase;
