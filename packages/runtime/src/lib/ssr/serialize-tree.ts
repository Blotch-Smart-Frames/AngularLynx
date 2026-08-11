import type { ElementRef } from '../types/lynx';
import type { OpcodeRecorder } from './opcodes';

/**
 * Walks the native Lynx element tree after Angular's initial render and
 * produces an opcode stream that the Lynx engine can store as a snapshot.
 * Each element is also marked via __MarkPartElement so the engine can
 * reconstruct the ElementRef→ssrId mapping during hydration.
 */
export const serializeElementTree = (
  root: ElementRef,
  recorder: OpcodeRecorder,
): void => {
  __MarkTemplateElement(root);
  serializeNode(root, recorder);
};

const serializeNode = (element: ElementRef, recorder: OpcodeRecorder): void => {
  const tag = __GetTag(element);

  // raw-text nodes are leaf text nodes — serialize with Text opcode
  if (tag === 'raw-text' || tag === 'rawtextelement') {
    const ssrId = recorder.nextId();
    __MarkPartElement(element, ssrId);
    const textContent = __GetAttributeByName(element, 'textContent') ?? '';
    recorder.text(ssrId, String(textContent));
    return;
  }

  const ssrId = recorder.nextId();
  __MarkPartElement(element, ssrId);
  recorder.begin(ssrId, tag);

  const attrs = __GetAttributes(element);
  for (const key in attrs) {
    const value = attrs[key];
    if (value != null && typeof value !== 'function') {
      recorder.attr(key, value);
    }
  }

  const classes = __GetClasses(element);
  if (classes.length > 0) {
    recorder.attr('class', classes.join(' '));
  }

  // __GetInlineStyles was added in a newer Lynx build — fall back to the
  // DOM-style `.style.cssText` property on older builds that lack the PAPI.
  const inlineStyles =
    typeof __GetInlineStyles === 'function'
      ? __GetInlineStyles(element)
      : (element as any).style?.cssText;
  if (inlineStyles) {
    recorder.attr('style', inlineStyles);
  }

  const children = __GetChildren(element);
  for (const child of children) {
    serializeNode(child, recorder);
  }

  recorder.end();
};
