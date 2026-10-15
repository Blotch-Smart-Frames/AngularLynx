/** Escapes text for an XML element or attribute (plists, manifests). */
export const escapeXml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/**
 * Replaces the text between `<!-- angular-lynx:<name> -->` and
 * `<!-- /angular-lynx:<name> -->` (or, when the template has a single marker
 * with no closing one, the marker itself). Templates mark the few places the
 * generator writes to, so everything else in them stays plain native code.
 */
export const replaceMarker = (
  source: string,
  name: string,
  content: string,
): string => {
  const open = `<!-- angular-lynx:${name} -->`;
  const close = `<!-- /angular-lynx:${name} -->`;
  const start = source.indexOf(open);
  if (start === -1) {
    throw new Error(`The template has no ${open} marker.`);
  }
  const closeAt = source.indexOf(close, start);
  const end = closeAt === -1 ? start + open.length : closeAt + close.length;
  // Indent inserted lines (and the closing marker) like the opening marker.
  const indent = /[ \t]*$/.exec(source.slice(0, start))![0];
  const lines = content
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => `\n${indent}${line}`)
    .join('');
  const closing = closeAt === -1 ? '' : `\n${indent}${close}`;
  return `${source.slice(0, start)}${open}${lines}${closing}${source.slice(end)}`;
};
