import { templateAttributeValue } from '../lynx-elements/base';
import { getPageId } from '../lynx-document/page-ref';
import type { ElementRef } from '../types/lynx';

/**
 * The attribute the build plugin gives a static block's root element (its
 * static-blocks.ts, which has a copy that a test keeps the same). Its value
 * is the block: the elements under the root, which the renderer builds when
 * Angular sets it.
 */
export const STATIC_BLOCK_ATTRIBUTE = 'ng-lynx-static';

/**
 * An element or text of a static block, as the build plugin writes it: a
 * text is its string, already trimmed as the runtime would show it, and an
 * element is `[tag, classes, inline style, [name, value, …], children]`.
 */
export type StaticNode =
  | string
  | readonly [
      tag: string,
      classes: string,
      style: string,
      attributes: readonly string[],
      children: readonly StaticNode[],
    ];

/** The elements and texts under a static block's root. */
export type StaticBlock = readonly StaticNode[];

/**
 * One element or text to create, with what to give it, in the order they're
 * created: each one's parent comes before it.
 */
type Step = {
  /** The element to create, `raw-text` for a text. */
  readonly tag: 'view' | 'text' | 'image' | 'raw-text';
  /** Its parent's position in the built elements, 0 for the root. */
  readonly parent: number;
  readonly classes: string;
  readonly style: string;
  /** Names and values, the values as LynxElement would set them. */
  readonly attributes: readonly unknown[];
  readonly text: string;
};

/**
 * The steps that build a block with one component's scope class, made the
 * first time the block is built. A block is in one component's consts, so
 * it's always built with the same scope; a different one makes new steps.
 */
const prepared = new WeakMap<
  StaticBlock,
  { scope: string; steps: readonly Step[] }
>();

const prepare = (block: StaticBlock, scope: string): readonly Step[] => {
  const cached = prepared.get(block);
  if (cached && cached.scope === scope) return cached.steps;
  const steps: Step[] = [];
  const add = (node: StaticNode, parent: number): void => {
    if (typeof node === 'string') {
      steps.push({
        tag: 'raw-text',
        parent,
        classes: '',
        style: '',
        attributes: [],
        text: node,
      });
      return;
    }
    const [tag, classes, style, names, children] = node;
    const attributes: unknown[] = [];
    for (let i = 0; i < names.length; i += 2) {
      // `flatten="false"` is false, as Angular's static attribute is when the
      // renderer sets it (see LynxRenderer.setAttribute).
      attributes.push(
        names[i],
        templateAttributeValue(names[i]!, names[i + 1]),
      );
    }
    // An Emulated component's elements all have its `_ngcontent-` class (see
    // EmulatedLynxRenderer.createElement), so its scoped CSS matches them.
    const all = scope ? (classes ? `${classes} ${scope}` : scope) : classes;
    steps.push({
      tag: tag as Step['tag'],
      parent,
      classes: all,
      style,
      attributes,
      text: '',
    });
    const position = steps.length;
    for (const child of children) add(child, position);
  };
  for (const node of block) add(node, 0);
  prepared.set(block, { scope, steps });
  return steps;
};

/**
 * Builds a static block's elements under its root with Lynx's element calls,
 * as React Lynx's snapshots do: no LynxElement, no node of Angular's.
 *
 * The build plugin folds only elements whose creation is one `__Create*`
 * call and the attributes, classes and style LynxElement would set the same
 * way (see its static-blocks.ts), so the native tree is the one Angular and
 * the renderer would have built. What the elements lose by having no
 * wrapper is what the plugin leaves out: listeners, bindings, local
 * references, queries and directives need Angular's nodes, and none of them
 * can name these elements.
 *
 * @param root - The root's native element, new and empty.
 * @param scope - The component's `_ngcontent-` class, or '' when its styles
 *   aren't scoped.
 */
export const buildStaticBlock = (
  root: ElementRef,
  block: StaticBlock,
  scope: string,
): void => {
  const steps = prepare(block, scope);
  const pageId = getPageId();
  const built: ElementRef[] = [root];
  for (const step of steps) {
    let element: ElementRef;
    switch (step.tag) {
      case 'raw-text':
        element = __CreateRawText(step.text);
        break;
      case 'text':
        element = __CreateText(pageId);
        break;
      case 'image':
        element = __CreateImage(pageId);
        break;
      default:
        element = __CreateView(pageId);
    }
    if (step.classes) __SetClasses(element, step.classes);
    if (step.style) __SetInlineStyles(element, step.style);
    const { attributes } = step;
    for (let i = 0; i < attributes.length; i += 2) {
      __SetAttribute(element, attributes[i] as string, attributes[i + 1]);
    }
    __AppendElement(built[step.parent]!, element);
    built.push(element);
  }
};

/** How many elements and texts a block holds, its root left out. */
export const staticBlockSize = (block: StaticBlock): number => {
  let size = 0;
  for (const node of block) {
    size += 1;
    if (typeof node !== 'string') size += staticBlockSize(node[4]);
  }
  return size;
};

/**
 * Whether an attribute value is a static block, rather than whatever an app
 * sets an attribute with this name to.
 */
export const isStaticBlock = (value: unknown): value is StaticBlock =>
  Array.isArray(value);
