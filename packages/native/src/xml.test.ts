import { describe, expect, it } from 'vitest';

import { escapeXml, replaceMarker } from './xml.ts';

describe('escapeXml', () => {
  it('escapes the five XML special characters', () => {
    expect(escapeXml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;',
    );
  });
});

describe('replaceMarker', () => {
  it('replaces the content between a pair of markers, keeping their indent', () => {
    const source = [
      '<dict>',
      '\t<!-- angular-lynx:info -->',
      '\t<key>Old</key>',
      '\t<!-- /angular-lynx:info -->',
      '</dict>',
    ].join('\n');
    expect(replaceMarker(source, 'info', '<key>A</key>\n<key>B</key>')).toBe(
      [
        '<dict>',
        '\t<!-- angular-lynx:info -->',
        '\t<key>A</key>',
        '\t<key>B</key>',
        '\t<!-- /angular-lynx:info -->',
        '</dict>',
      ].join('\n'),
    );
  });

  it('inserts after a single marker that has no closing one', () => {
    const source =
      '<manifest>\n    <!-- angular-lynx:permissions -->\n</manifest>';
    expect(replaceMarker(source, 'permissions', '<uses-permission />')).toBe(
      '<manifest>\n    <!-- angular-lynx:permissions -->\n    <uses-permission />\n</manifest>',
    );
  });

  it('leaves the marker alone when there is nothing to insert', () => {
    const source = 'a\n<!-- angular-lynx:x -->\nb';
    expect(replaceMarker(source, 'x', '')).toBe(source);
  });

  it('throws when the template lacks the marker', () => {
    expect(() => replaceMarker('<dict/>', 'info', 'x')).toThrow(
      'The template has no <!-- angular-lynx:info --> marker.',
    );
  });
});
