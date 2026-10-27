/**
 * Builds Lynx elements for the query specs.
 *
 * The specs build elements with createElement rather than innerHTML because
 * the HTML parser turns an `<image>` tag into an `<img>`, and Lynx's
 * `<image>` is what they need. The testing environment's PAPI creates
 * elements the same way.
 */
export const el = (
  tag: string,
  attributes: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElement => {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  element.append(...children);
  return element;
};

/**
 * Puts `children` in a fresh `<page>` in the document, the container the
 * queries search, as render() would.
 */
export const mount = (...children: (Node | string)[]): HTMLElement => {
  const page = el('page', {}, ...children);
  document.body.replaceChildren(page);
  return page;
};
