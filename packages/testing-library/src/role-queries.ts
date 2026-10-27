/**
 * `*ByRole` queries that read Lynx's accessibility attributes.
 *
 * Testing Library works out an element's role from `role` and HTML, and its
 * name and state from `aria-*` attributes. A Lynx element has none of those,
 * so on a Lynx tree Testing Library's `getByRole` found almost nothing: a
 * `<view accessibility-traits="button">` has no ARIA role. These queries add
 * what Lynx gives screen readers, read the way Lynx's native code reads it,
 * to what Testing Library finds (a Lynx `<input>` is still a
 * textbox):
 *
 * - Role: each trait in `accessibility-traits` that names a kind of element
 *   (`TRAIT_ROLES`), or the element's own default: an `<image>` is an image.
 * - Exposed: a screen reader reaches an element only when it's an
 *   accessibility element. `<text>` and `<image>` are by default; anything
 *   else needs `accessibility-element="true"`. The exception is a tab bar,
 *   whose trait VoiceOver reads from the container around the tabs.
 *   `accessibility-elements-hidden` hides an element and everything inside
 *   it. With `hidden: false`, the default, the rest are left out, as Testing
 *   Library leaves out what's off the accessibility tree.
 * - Name: `accessibility-label`, or a `<text>`'s own text when it has none.
 *   Lynx gives no other element a name from the text inside it: iOS reads an
 *   accessibility element's label and skips its children.
 * - State: the `selected` trait is `selected: true`, and `accessibility-value`
 *   is `value: { text }`. Lynx has no other ARIA state.
 *
 * They take Testing Library's ByRoleOptions and throw its error messages.
 */

import {
  type ByRoleMatcher,
  type ByRoleOptions,
  buildQueries,
  getConfig,
  getRoles,
  isInaccessible,
  prettyDOM,
  queries as domQueries,
} from '@testing-library/dom';

/**
 * The ARIA role of each Lynx trait that names a kind of element, as
 * Testing Library spells it. iOS turns each trait into a UIAccessibilityTraits
 * flag (`LynxConverter+UI.m`): `image` is UIAccessibilityTraitImage, the
 * `img` role; `header` is a heading; `search`, a search field, is a searchbox;
 * `adjustable`, a control swiped up and down through values, is a slider;
 * and `tabbar`, a tab bar, is a tablist. The other traits describe state (`selected`,
 * `disabled`, `updating`), behavior (`playable`, `keyboard`, `summary`), or
 * plain text (`text`), which has no ARIA role.
 */
const TRAIT_ROLES: ReadonlyMap<string, string> = new Map([
  ['button', 'button'],
  ['link', 'link'],
  ['image', 'img'],
  ['header', 'heading'],
  ['search', 'searchbox'],
  ['adjustable', 'slider'],
  ['tabbar', 'tablist'],
]);

/**
 * The roles a screen reader reads from a container, not from an
 * accessibility element. VoiceOver reads the tab bar trait from the view
 * around the tabs, which can't be an accessibility element itself: that
 * would hide the tabs inside it.
 */
const CONTAINER_ROLES: ReadonlySet<string> = new Set(['tablist']);

/**
 * Testing Library refuses a state that ARIA doesn't define for the role, such
 * as `selected` on a button. Lynx has `selected` (a trait) and a value
 * (`accessibility-value`) on any element, so asking for them isn't a mistake
 * here. It only means no element can match by ARIA.
 */
const UNSUPPORTED_ARIA_STATE =
  /^"aria-(selected|valuetext)" is not supported on role /;

/**
 * Matches text the way Testing Library matches a name or value: a string or
 * number exactly, a RegExp by `test()`, or a function that decides.
 */
type TextMatcher =
  | string
  | number
  | RegExp
  | ((text: string, element: Element) => boolean);

/**
 * Whether `text` matches `matcher`. Text the element doesn't have (null)
 * matches nothing.
 */
const matchesText = (
  text: string | null,
  element: Element,
  matcher: TextMatcher,
): boolean => {
  if (text === null) return false;
  if (typeof matcher === 'function') return matcher(text, element);
  if (matcher instanceof RegExp) {
    const match = matcher.test(text);
    // A global or sticky RegExp carries on from where the last test() left
    // off, so the next element is tested from the start, as Testing Library
    // does.
    matcher.lastIndex = 0;
    return match;
  }
  return text === String(matcher);
};

/**
 * The element's traits. iOS splits `accessibility-traits` on commas and
 * doesn't trim them, so `"button, selected"` isn't selected there: they're
 * read the same way here. Android and HarmonyOS read the attribute as one
 * trait, so a list only works on iOS. Without the attribute, an `<image>` has
 * the image trait, Lynx's default for it (`LynxUIImage`), which
 * `accessibility-traits="none"` takes away.
 */
const traitsOf = (element: Element): string[] =>
  element.getAttribute('accessibility-traits')?.split(',') ??
  (element.localName === 'image' ? ['image'] : []);

/**
 * The ARIA roles the element's traits give it.
 */
const lynxRolesOf = (element: Element): string[] =>
  traitsOf(element).flatMap((trait) => TRAIT_ROLES.get(trait) ?? []);

/**
 * Whether the element is an accessibility element, one stop for a screen
 * reader. Lynx makes `<text>` and `<image>` accessibility elements by default
 * and nothing else, so a `<view>` is one only with
 * `accessibility-element="true"`. The attribute holds a string, so any value
 * but "false" is true, as the element directives' boolean inputs read it.
 */
const isAccessibilityElement = (element: Element): boolean => {
  const flag = element.getAttribute('accessibility-element');
  return flag === null
    ? element.localName === 'text' || element.localName === 'image'
    : flag !== 'false';
};

/**
 * Whether a screen reader reads `role` on the element: from an accessibility
 * element, or from a container for a container role, as long as nothing
 * hides it.
 */
const exposesRole = (element: Element, role: string): boolean =>
  (isAccessibilityElement(element) || CONTAINER_ROLES.has(role)) &&
  element.closest(
    '[accessibility-elements-hidden]:not([accessibility-elements-hidden="false"])',
  ) === null &&
  // Testing Library's own check catches what Lynx doesn't draw either, such
  // as an element styled display: none.
  !isInaccessible(element);

/**
 * What a screen reader reads as the element's name: its
 * `accessibility-label`, or for a `<text>`, the text it shows (iOS and
 * Android read that when the label is missing or empty).
 */
const lynxNameOf = (element: Element): string =>
  element.getAttribute('accessibility-label') ||
  (element.localName === 'text'
    ? element.textContent!.replace(/\s+/g, ' ').trim()
    : '');

/**
 * Whether the element is in the states `options` asks for. Lynx has two:
 * the `selected` trait, and the value in `accessibility-value`. For the rest
 * it answers as Testing Library does for an element without the `aria-*`
 * attribute: not busy and not current, and never pressed, expanded, at a
 * level or at a number. `checked` never gets here: Testing Library refuses
 * it on every role Lynx gives.
 */
const matchesState = (
  element: Element,
  traits: readonly string[],
  {
    selected,
    busy,
    pressed,
    current,
    expanded,
    level,
    value = {},
  }: ByRoleOptions,
): boolean =>
  (selected === undefined || selected === traits.includes('selected')) &&
  !busy &&
  (current === undefined || current === false) &&
  pressed === undefined &&
  expanded === undefined &&
  level === undefined &&
  value.now === undefined &&
  value.min === undefined &&
  value.max === undefined &&
  (value.text === undefined ||
    matchesText(
      element.getAttribute('accessibility-value'),
      element,
      value.text,
    ));

/**
 * The elements Lynx gives `role`.
 */
const queryAllByLynxRole = (
  container: HTMLElement,
  role: ByRoleMatcher,
  options: ByRoleOptions,
): HTMLElement[] => {
  const { hidden = getConfig().defaultHidden, name, description } = options;
  return Array.from(container.querySelectorAll<HTMLElement>('*')).filter(
    (element) => {
      const traits = traitsOf(element);
      return (
        traits.some((trait) => TRAIT_ROLES.get(trait) === role) &&
        (hidden || exposesRole(element, role)) &&
        matchesState(element, traits, options) &&
        (name === undefined ||
          matchesText(lynxNameOf(element), element, name)) &&
        // Lynx has no accessible description.
        (description === undefined || matchesText('', element, description))
      );
    },
  );
};

/**
 * The elements Testing Library gives `role`, from `role` attributes and HTML
 * elements. An `accessibility-label` still names them: Lynx reads it on any
 * element, an `<input>` included.
 */
const queryAllByAriaRole = (
  container: HTMLElement,
  role: ByRoleMatcher,
  options: ByRoleOptions,
): HTMLElement[] => {
  const { name } = options;
  try {
    return domQueries.queryAllByRole(container, role, {
      ...options,
      name:
        name === undefined
          ? undefined
          : (accessibleName, element) =>
              matchesText(
                element.getAttribute('accessibility-label') || accessibleName,
                element,
                name,
              ),
    });
  } catch (error) {
    if (UNSUPPORTED_ARIA_STATE.test((error as Error).message)) return [];
    throw error;
  }
};

/**
 * Every element in `container` with `role`, whether Lynx or Testing Library
 * gives it the role, in document order. Testing Library's query runs first,
 * so a container that isn't an element fails with its message.
 */
const queryAllByRole = (
  container: HTMLElement,
  role: ByRoleMatcher,
  options: ByRoleOptions = {},
): HTMLElement[] => {
  const found = new Set<Element>([
    ...queryAllByAriaRole(container, role, options),
    ...queryAllByLynxRole(container, role, options),
  ]);
  return Array.from(container.querySelectorAll<HTMLElement>('*')).filter(
    (element) => found.has(element),
  );
};

/**
 * Describes a name or description matcher for an error message, as Testing
 * Library does: a string in quotes, anything else in backticks.
 */
const describeMatcher = (label: string, matcher: unknown): string => {
  if (matcher === undefined) return '';
  return typeof matcher === 'string'
    ? ` and ${label} "${matcher}"`
    : ` and ${label} \`${String(matcher)}\``;
};

/**
 * Lists the roles in `container` with each element's name and markup, as
 * Testing Library's error does, including the roles Lynx gives.
 */
const prettyRoles = (container: HTMLElement, hidden: boolean): string => {
  // A Set per role lists an element once, even when both Lynx and Testing
  // Library give it the role.
  const elementsByRole = new Map<string, Set<Element>>();
  const add = (role: string, element: Element): void => {
    elementsByRole.set(
      role,
      (elementsByRole.get(role) ?? new Set()).add(element),
    );
  };
  for (const element of Array.from(container.querySelectorAll('*'))) {
    for (const role of lynxRolesOf(element)) {
      if (hidden || exposesRole(element, role)) add(role, element);
    }
  }
  // getRoles() takes the hidden option, though its types leave it out.
  const getAriaRoles = getRoles as (
    element: HTMLElement,
    options: { hidden: boolean },
  ) => Record<string, HTMLElement[]>;
  // Testing Library lists each child's roles, which leaves out the container.
  for (const child of Array.from(container.children)) {
    for (const [role, elements] of Object.entries(
      getAriaRoles(child as HTMLElement, { hidden }),
    )) {
      // Testing Library leaves the generic role out of its list too.
      if (role !== 'generic') elements.forEach((el) => add(role, el));
    }
  }
  return Array.from(elementsByRole)
    .map(([role, elements]) => {
      const described = Array.from(elements)
        .map(
          (element) =>
            `Name "${lynxNameOf(element)}":\n${prettyDOM(element.cloneNode(false) as Element)}`,
        )
        .join('\n\n');
      return `${role}:\n\n${described}\n\n${'-'.repeat(50)}`;
    })
    .join('\n');
};

/**
 * The error message when no element has the role, worded as Testing
 * Library's and followed by what Lynx does differently: a trait whose role
 * has another name, or elements with the role that screen readers can't
 * reach.
 */
const getMissingError = (
  container: Element | null,
  role: ByRoleMatcher,
  options: ByRoleOptions = {},
): string => {
  const { hidden = getConfig().defaultHidden, name, description } = options;
  const nameHint = describeMatcher('name', name);
  const traitRole = TRAIT_ROLES.get(role);
  const traitHint =
    traitRole !== undefined && traitRole !== role
      ? `\n\nLynx's ${role} trait is the "${traitRole}" role, so query by "${traitRole}".`
      : '';
  // waitFor() turns expensive diagnostics off while it retries a find*
  // query, and Testing Library then says only which role it looked for.
  if (
    (getConfig() as { _disableExpensiveErrorDiagnostics?: boolean })
      ._disableExpensiveErrorDiagnostics
  ) {
    return `Unable to find role="${role}"${nameHint}${traitHint}`;
  }
  const searched = container as HTMLElement;
  const roles = prettyRoles(searched, hidden);
  let roleMessage: string;
  if (roles.length === 0) {
    roleMessage = hidden
      ? 'There are no available roles.'
      : 'There are no accessible roles. But there might be some inaccessible roles. If you wish to access them, then set the `hidden` option to `true`. Learn more about this here: https://testing-library.com/docs/dom-testing-library/api-queries#byrole';
  } else {
    roleMessage =
      `Here are the ${hidden ? 'available' : 'accessible'} roles:\n\n  ${roles
        .replace(/\n/g, '\n  ')
        .replace(/\n\s\s\n/g, '\n\n')}`.trim();
  }
  const unexposedHint =
    !hidden &&
    queryAllByLynxRole(searched, role, { hidden: true }).some(
      (element) => !exposesRole(element, role),
    )
      ? `\n\nSome elements with the role "${role}" are hidden from screen readers. Lynx reaches an element other than <text> and <image> only when it sets accessibility-element="true", and nothing inside accessibility-elements-hidden="true". Set the \`hidden\` option to \`true\` to include them.`
      : '';
  return `Unable to find an ${hidden ? '' : 'accessible '}element with the role "${role}"${nameHint}${describeMatcher('description', description)}\n\n${roleMessage}${traitHint}${unexposedHint}`;
};

const [queryBy, getAllBy, getBy, findAllBy, findBy] = buildQueries(
  queryAllByRole,
  (_container, role, { name } = {}) =>
    `Found multiple elements with the role "${role}"${describeMatcher('name', name)}`,
  getMissingError,
);

// buildQueries returns HTMLElement-typed functions. These take the generic
// types of Testing Library's own role queries, so they stand in for them
// anywhere, getByRole<TextElement>(...) included.
const queryAll = queryAllByRole as typeof domQueries.queryAllByRole;
const query = queryBy as typeof domQueries.queryByRole;
const getAll = getAllBy as typeof domQueries.getAllByRole;
const get = getBy as typeof domQueries.getByRole;
const findAll = findAllBy as typeof domQueries.findAllByRole;
const find = findBy as typeof domQueries.findByRole;

export {
  queryAll as queryAllByRole,
  query as queryByRole,
  getAll as getAllByRole,
  get as getByRole,
  findAll as findAllByRole,
  find as findByRole,
};
