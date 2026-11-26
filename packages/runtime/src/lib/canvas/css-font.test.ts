import { describe, expect, it } from 'vitest';
import { DEFAULT_FONT, parseFont } from './css-font';

describe('parseFont', () => {
  it('reads the size and families, and writes the font back as browsers do', () => {
    expect(parseFont('12px Arial')).toEqual({
      italic: false,
      smallCaps: false,
      weight: 400,
      size: 12,
      families: ['Arial'],
      text: '12px Arial',
    });
    expect(parseFont('10px sans-serif')).toEqual(DEFAULT_FONT);
  });

  it('reads the style, variant, weight and stretch before the size', () => {
    const font = parseFont(
      'italic small-caps bold condensed 2em/1.5 "Helvetica Neue", serif',
    );
    expect(font).toMatchObject({
      italic: true,
      smallCaps: true,
      weight: 700,
      size: 32,
      families: ['Helvetica Neue', 'serif'],
      text: 'italic small-caps bold condensed 32px "Helvetica Neue", serif',
    });
    expect(parseFont('normal oblique 600 12pt Menlo')).toMatchObject({
      italic: true,
      weight: 600,
      size: 16,
      text: 'oblique 600 16px Menlo',
    });
    expect(parseFont('700 1rem x')).toMatchObject({
      weight: 700,
      text: 'bold 16px x',
    });
    expect(parseFont('400 1px x')?.text).toBe('1px x');
    expect(parseFont('lighter 1px x')?.weight).toBe(100);
    expect(parseFont('bolder 1px x')?.weight).toBe(700);
  });

  it('reads every size unit and keyword', () => {
    const sizes: [string, number][] = [
      ['medium', 16],
      ['xx-large', 32],
      ['larger', 19.2],
      ['smaller', 16 / 1.2],
      ['1in', 96],
      ['2.54cm', 96],
      ['25.4mm', 96],
      ['1pc', 16],
      ['101.6q', 96],
      ['50%', 8],
      ['.5em', 8],
    ];
    for (const [size, pixels] of sizes) {
      expect(parseFont(`${size} serif`)?.size).toBeCloseTo(pixels);
    }
  });

  it('draws the system fonts in the system’s', () => {
    expect(parseFont('caption')).toMatchObject({
      size: 13,
      families: ['system-ui'],
      text: '13px system-ui',
    });
  });

  it('quotes a family that needs it', () => {
    expect(parseFont("12px 'My Font!'")?.text).toBe('12px "My Font!"');
    expect(parseFont("12px '3D'")?.text).toBe('12px "3D"');
  });

  it('splits families only at commas outside quotes', () => {
    expect(parseFont('16px "A,B", serif')).toMatchObject({
      families: ['A,B', 'serif'],
      text: '16px "A,B", serif',
    });
    expect(parseFont("16px '  Spaced  Name'")?.families).toEqual([
      '  Spaced  Name',
    ]);
    expect(parseFont('16px 微软雅黑, sans-serif')?.families).toEqual([
      '微软雅黑',
      'sans-serif',
    ]);
  });

  it('reads line breaks round the families, and escapes in quoted ones', () => {
    expect(parseFont('16px\n"Arial",\n serif')?.families).toEqual([
      'Arial',
      'serif',
    ]);
    const quoted = parseFont('16px "A\\"B", serif');
    expect(quoted?.families).toEqual(['A"B', 'serif']);
    expect(quoted?.text).toBe('16px "A\\"B", serif');
    expect(parseFont(quoted!.text)?.families).toEqual(['A"B', 'serif']);
    expect(parseFont("16px 'A\\\\B'")?.text).toBe('16px "A\\\\B"');
    expect(parseFont('16px "\\41 rial"')?.families).toEqual(['Arial']);
    expect(parseFont('16px "\\0"')?.families).toEqual(['\ufffd']);
    expect(parseFont('16px "A\\')).toBeNull();
  });

  it('keeps a quoted keyword a family name, and refuses one unquoted', () => {
    expect(parseFont('16px inherit')).toBeNull();
    expect(parseFont('16px Arial, initial')).toBeNull();
    expect(parseFont('16px "inherit"')?.text).toBe('16px "inherit"');
    expect(parseFont('16px "serif", serif')?.text).toBe('16px "serif", serif');
  });

  it('reads a line height after a slash, with or without spaces, and checks it', () => {
    expect(parseFont('16px / 1.5 Arial')?.families).toEqual(['Arial']);
    expect(parseFont('16px/normal Arial')?.text).toBe('16px Arial');
    expect(parseFont('16px /20px Arial')?.size).toBe(16);
    expect(parseFont('16px/nope Arial')).toBeNull();
    expect(parseFont('16px /')).toBeNull();
  });

  it('takes each keyword once', () => {
    expect(parseFont('italic oblique 16px serif')).toBeNull();
    expect(parseFont('small-caps small-caps 16px serif')).toBeNull();
    expect(parseFont('bold 300 16px serif')).toBeNull();
    expect(parseFont('lighter bold 16px serif')).toBeNull();
    expect(parseFont('bold lighter 16px serif')).toBeNull();
    expect(parseFont('condensed expanded 16px serif')).toBeNull();
    expect(parseFont('normal normal normal normal 16px serif')?.text).toBe(
      '16px serif',
    );
    expect(
      parseFont('normal normal normal normal normal 16px serif'),
    ).toBeNull();
    expect(
      parseFont('italic normal normal normal normal 16px serif'),
    ).toBeNull();
    expect(parseFont('italic bold 16px serif')?.text).toBe(
      'italic bold 16px serif',
    );
  });

  it('turns down what isn’t a font', () => {
    for (const text of [
      'Arial',
      '12px',
      '12 Arial',
      '-1px Arial',
      '12px Arial,',
      '1e999px Arial',
      '12px 3D',
      '12px Ar@ial',
      '12px "Arial',
      '12px "A" "B"',
      '12px Arial,',
      '1e999px Arial',
      'bold',
    ]) {
      expect(parseFont(text)).toBeNull();
    }
    expect(parseFont(12)).toBeNull();
  });
});
