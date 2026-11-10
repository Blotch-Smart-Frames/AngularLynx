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
