import { describe, expect, it } from 'vitest';

import { NativeConfigError, compact, resolveAppOptions } from './options.ts';

const defaults = { projectName: 'my-app', packageVersion: '0.0.0' };

describe('resolveAppOptions', () => {
  it('derives every value from the project when nothing is set', () => {
    expect(resolveAppOptions({}, defaults)).toEqual({
      name: 'my-app',
      id: 'com.example.myapp',
      version: '1.0.0',
      buildNumber: 1,
      orientation: 'portrait',
      edgeToEdge: true,
      permissions: {},
      deepLinkSchemes: [],
      canOpenURLSchemes: ['http', 'https', 'mailto', 'tel', 'sms'],
      shortcuts: [],
      icon: undefined,
      productName: 'myapp',
      artifactName: 'my-app',
      ios: {},
      android: {},
    });
  });

  it('uses package.json version unless it is the 0.0.0 from ng new', () => {
    expect(
      resolveAppOptions({}, { ...defaults, packageVersion: '2.3.1' }).version,
    ).toBe('2.3.1');
    expect(
      resolveAppOptions({}, { ...defaults, packageVersion: '2.0.0-beta.1' })
        .version,
    ).toBe('1.0.0');
  });

  it('turns the app name into a product name and an artifact name', () => {
    const app = resolveAppOptions({ appName: '  My Cool App!  ' }, defaults);
    expect(app.name).toBe('My Cool App!');
    expect(app.productName).toBe('MyCoolApp');
    expect(app.artifactName).toBe('my-cool-app');
  });

  it('falls back to App/app when the name has no letters or digits', () => {
    const app = resolveAppOptions({ appName: '日記' }, defaults);
    expect(app.productName).toBe('App');
    expect(app.artifactName).toBe('app');
  });

  it('starts a default ID segment with a letter', () => {
    expect(resolveAppOptions({}, { projectName: '2048' }).id).toBe(
      'com.example.app2048',
    );
  });

  it.each([
    ['com.example.my_app', 'underscores'],
    ['com.example.my-app', 'hyphens'],
    ['myapp', 'a single segment'],
    ['com.1example.app', 'a segment starting with a digit'],
  ])('rejects the app ID %s (%s)', (appId) => {
    expect(() => resolveAppOptions({ appId }, defaults)).toThrow(
      NativeConfigError,
    );
  });

  it.each(['1.2.3.4', 'v1', '1.0-beta'])(
    'rejects the version %s',
    (version) => {
      expect(() => resolveAppOptions({ version }, defaults)).toThrow(/version/);
    },
  );

  it.each([0, 1.5, 2_100_000_001])(
    'rejects the build number %s',
    (buildNumber) => {
      expect(() => resolveAppOptions({ buildNumber }, defaults)).toThrow(
        /buildNumber/,
      );
    },
  );

  it('rejects an empty app name', () => {
    expect(() => resolveAppOptions({ appName: ' ' }, defaults)).toThrow(
      /appName/,
    );
  });

  it('rejects unknown permissions and permissions without a reason', () => {
    expect(() =>
      resolveAppOptions({ permissions: { bluetooth: 'x' } as never }, defaults),
    ).toThrow(/Unknown permission "bluetooth"/);
    expect(() =>
      resolveAppOptions({ permissions: { camera: ' ' } }, defaults),
    ).toThrow(/permissions.camera/);
  });

  it('adds the schemes canOpenURL asks about after the ones always there, each once', () => {
    expect(
      resolveAppOptions(
        { canOpenURLSchemes: ['WhatsApp', 'whatsapp', 'HTTPS', 'instagram'] },
        defaults,
      ).canOpenURLSchemes,
    ).toEqual([
      'http',
      'https',
      'mailto',
      'tel',
      'sms',
      'whatsapp',
      'instagram',
    ]);
  });

  it('rejects a canOpenURL scheme that is not a scheme', () => {
    expect(() =>
      resolveAppOptions({ canOpenURLSchemes: ['whatsapp://'] }, defaults),
    ).toThrow(
      'canOpenURLSchemes entry "whatsapp://" is not a valid URL scheme. Give the scheme alone, without "://", e.g. "whatsapp".',
    );
  });

  it('rejects more canOpenURL schemes than iOS reads', () => {
    const schemes = (count: number) =>
      Array.from({ length: count }, (_, index) => `app${index}`);
    expect(
      resolveAppOptions({ canOpenURLSchemes: schemes(45) }, defaults)
        .canOpenURLSchemes,
    ).toHaveLength(50);
    expect(() =>
      resolveAppOptions({ canOpenURLSchemes: schemes(46) }, defaults),
    ).toThrow(
      'canOpenURLSchemes lists 51 schemes with the 5 always there (http, https, mailto, tel, sms). iOS reads no more than 50.',
    );
  });

  it('rejects invalid URL schemes', () => {
    expect(() =>
      resolveAppOptions({ deepLinkSchemes: ['my app'] }, defaults),
    ).toThrow(/deepLinkSchemes/);
    expect(
      resolveAppOptions({ deepLinkSchemes: ['my-app+x.y'] }, defaults)
        .deepLinkSchemes,
    ).toEqual(['my-app+x.y']);
  });

  it('gives a shortcut a phrase from its title, and keeps the ones it has', () => {
    expect(
      resolveAppOptions(
        {
          shortcuts: [
            { id: 'refresh', title: '  Refresh  ' },
            {
              id: 'show-photos',
              title: 'Show photos',
              phrases: [' Show photos in {appName} ', 'Open {appName} photos'],
              route: '/photos',
              symbol: 'photo.on.rectangle',
            },
          ],
        },
        defaults,
      ).shortcuts,
    ).toEqual([
      { id: 'refresh', title: 'Refresh', phrases: ['Refresh in {appName}'] },
      {
        id: 'show-photos',
        title: 'Show photos',
        phrases: ['Show photos in {appName}', 'Open {appName} photos'],
        route: '/photos',
        symbol: 'photo.on.rectangle',
      },
    ]);
  });

  it('rejects more shortcuts than iOS takes', () => {
    const shortcuts = Array.from({ length: 11 }, (_, index) => ({
      id: `shortcut${index}`,
      title: `Shortcut ${index}`,
    }));
    expect(() => resolveAppOptions({ shortcuts }, defaults)).toThrow(
      'shortcuts lists 11. iOS takes no more than 10 from an app.',
    );
    expect(
      resolveAppOptions({ shortcuts: shortcuts.slice(1) }, defaults).shortcuts,
    ).toHaveLength(10);
  });

  it.each([
    ['show photos', 'a space'],
    ['1st', 'a digit first'],
    ['', 'nothing'],
    [undefined, 'no ID at all'],
  ])('rejects the shortcut ID %j: %s', (id) => {
    expect(() =>
      resolveAppOptions(
        { shortcuts: [{ id, title: 'Show photos' }] } as never,
        defaults,
      ),
    ).toThrow(/shortcuts\[0\]\.id .* is not valid/);
  });

  it('rejects two shortcuts whose IDs name the same Swift type and Android resource', () => {
    for (const ids of [
      ['refresh', 'refresh'],
      ['show-photos', 'show_photos'],
      ['refresh', 'Refresh'],
    ]) {
      expect(() =>
        resolveAppOptions(
          { shortcuts: ids.map((id) => ({ id, title: id })) },
          defaults,
        ),
      ).toThrow(/two entries with the id/);
    }
  });

  it('rejects a shortcut without a title on one line', () => {
    for (const title of ['', '   ', 'Show\nphotos', undefined]) {
      expect(() =>
        resolveAppOptions(
          { shortcuts: [{ id: 'photos', title }] } as never,
          defaults,
        ),
      ).toThrow('shortcuts "photos" needs a title on one line');
    }
  });

  it("rejects a phrase that doesn't name the app, which Siri wouldn't listen for", () => {
    for (const phrase of ['Show my photos', 'Show\n{appName}', 42]) {
      expect(() =>
        resolveAppOptions(
          {
            shortcuts: [
              { id: 'photos', title: 'Show photos', phrases: [phrase] },
            ],
          } as never,
          defaults,
        ),
      ).toThrow(/doesn't name the app/);
    }
  });

  it('rejects an empty list of phrases, and a phrase two shortcuts share', () => {
    expect(() =>
      resolveAppOptions(
        { shortcuts: [{ id: 'photos', title: 'Show photos', phrases: [] }] },
        defaults,
      ),
    ).toThrow('shortcuts "photos" has no phrases');
    expect(() =>
      resolveAppOptions(
        {
          shortcuts: [
            { id: 'photos', title: 'Photos', phrases: ['Open {appName}'] },
            { id: 'albums', title: 'Albums', phrases: ['open {appName}'] },
          ],
        },
        defaults,
      ),
    ).toThrow('shortcuts has the phrase "open {appName}" twice');
  });

  it('rejects a route that is not a path, and a symbol that is not an SF Symbol name', () => {
    for (const route of ['photos', 'https://example.com', 7]) {
      expect(() =>
        resolveAppOptions(
          { shortcuts: [{ id: 'photos', title: 'Photos', route }] } as never,
          defaults,
        ),
      ).toThrow(/has the route .* starting with "\/"/);
    }
    for (const symbol of ['photo on rectangle', 'photo..fill', 7]) {
      expect(() =>
        resolveAppOptions(
          { shortcuts: [{ id: 'photos', title: 'Photos', symbol }] } as never,
          defaults,
        ),
      ).toThrow(/is not an SF Symbol's name/);
    }
  });

  it("names an empty shortcut entry, which Angular CLI's undefined keys leave", () => {
    expect(() =>
      resolveAppOptions(
        { shortcuts: [{ id: undefined, title: undefined }] } as never,
        defaults,
      ),
    ).toThrow(/shortcuts\[0\]\.id/);
  });

  it('accepts an adaptive icon with a color or a PNG background', () => {
    for (const background of ['#111111', '#fff', 'bg.PNG']) {
      expect(
        resolveAppOptions(
          {
            icon: 'icon.png',
            android: { adaptiveIcon: { foreground: 'fg.png', background } },
          },
          defaults,
        ).android.adaptiveIcon,
      ).toEqual({ foreground: 'fg.png', background });
    }
  });

  it.each([
    [{ foreground: 'fg.png' }, /needs both a foreground/],
    [{ background: '#111111' }, /needs both a foreground/],
    [{ foreground: 'fg.png', background: '#1111' }, /neither a color/],
    [{ foreground: 'fg.png', background: 'navy' }, /neither a color/],
    [{ foreground: 'fg.png', background: 'bg.jpg' }, /neither a color/],
  ])('rejects the adaptive icon %j', (adaptiveIcon, message) => {
    expect(() =>
      resolveAppOptions(
        { icon: 'icon.png', android: { adaptiveIcon } },
        defaults,
      ),
    ).toThrow(message);
  });

  it('needs icon for the flat icon when the adaptive icon is set', () => {
    expect(() =>
      resolveAppOptions(
        {
          android: {
            adaptiveIcon: { foreground: 'fg.png', background: '#111111' },
          },
        },
        defaults,
      ),
    ).toThrow(
      new NativeConfigError(
        'android.adaptiveIcon needs icon too: Android 7 shows the flat icon made from it.',
      ),
    );
  });

  it('accepts the two .ipa export methods and rejects any other', () => {
    expect(
      resolveAppOptions({ ios: { export: 'release-testing' } }, defaults).ios
        .export,
    ).toBe('release-testing');
    expect(() =>
      resolveAppOptions({ ios: { export: 'ad-hoc' } } as never, defaults),
    ).toThrow(
      'ios.export "ad-hoc" is not valid. Use app-store-connect or release-testing.',
    );
  });

  it('ignores the undefined keys Angular CLI fills in for nested options', () => {
    const app = resolveAppOptions(
      {
        permissions: { camera: undefined },
        ios: { teamId: undefined, signing: { keyIdEnv: undefined } },
      } as never,
      defaults,
    );
    expect(app.permissions).toEqual({});
    expect(app.ios).toEqual({});
  });
});

describe('compact', () => {
  it('drops undefined values and objects they leave empty', () => {
    expect(
      compact({ a: 1, b: undefined, c: { d: undefined }, e: [{ f: 1 }] }),
    ).toEqual({ a: 1, e: [{ f: 1 }] });
    expect(compact({ a: undefined })).toBeUndefined();
    expect(compact('x')).toBe('x');
    expect(compact(null)).toBeNull();
  });
});
