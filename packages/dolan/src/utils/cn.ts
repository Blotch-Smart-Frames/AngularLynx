import { clsx, type ClassValue } from 'clsx';
import { createTailwindMerge } from 'tailwind-merge';

import { createComponentConfig } from './cn-config';

/**
 * Makes a `cn()` with a cache and class map of its own. Apps use `cn`; this
 * is for tests, which need one that hasn't seen another test's classes.
 */
export const createCn = (): ((...inputs: ClassValue[]) => string) => {
  // tailwind-merge builds the config and its class map on the first merge,
  // so an app that never merges a class pays for neither.
  const merge = createTailwindMerge(createComponentConfig);
  return (...inputs) => merge(clsx(inputs));
};

/**
 * Joins class names as `clsx()` does, then merges the Tailwind classes in
 * them as tailwind-merge's `twMerge()` does, for the classes the `@blotch/ui`
 * components use: of two conflicting classes, the later one wins.
 *
 * It knows tailwind-merge's groups with a class under a first part the
 * components use (`bg`, `px`, `text`, `rounded`...; `COMPONENT_CLASS_ROOTS`
 * lists them), every group that conflicts with one, and the classes apps
 * often pass to a `class` input, such as `mr-2` or `italic`. So a class an
 * app passes still replaces a component's conflicting one. A class of
 * another group, such as `cursor-pointer` or `rotate-45`, is kept as it is:
 * `cn('rotate-45', 'rotate-90')` returns both, where `twMerge()` keeps the
 * last. Only these groups are in the app's script, which keeps out about
 * 10 kB of tailwind-merge's config, and the heap its code costs (#945).
 */
export const cn = createCn();
