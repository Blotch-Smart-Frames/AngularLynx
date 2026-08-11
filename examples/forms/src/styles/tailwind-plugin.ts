import plugin from 'tailwindcss/plugin';

// Colors reference CSS variables DIRECTLY (var(--xxx)) instead of the shadcn/ui
// pattern of wrapping in hsl() (e.g., 'hsl(var(--primary) / <alpha-value>)').
//
// The shadcn/ui pattern stores raw HSL components in variables (--primary: 240 5.9% 10%)
// and wraps them in hsl() at usage time. This enables Tailwind's opacity modifier
// syntax (bg-primary/50), but Lynx's native CSS engine doesn't support hsl() —
// it only understands #hex, rgb(), and rgba(). After CSS variable resolution,
// Lynx would see 'hsl(240 5.9% 10% / 1)' which it can't parse, producing
// invisible colors on iOS while working fine in the web preview (browsers support hsl).
//
// Instead, CSS variables store COMPLETE rgba() values (--primary: rgba(24, 24, 27, 1))
// and Tailwind references them directly. This matches the official React Lynx
// Tailwind example (references/lynx-stack-main/examples/tailwindcss/).
//
// Tradeoff: Tailwind opacity modifiers (bg-primary/50) won't work since colors
// aren't decomposed. Use explicit opacity utilities (opacity-50) instead.
export const blotchPlugin = plugin(
  ({ addBase }) => {
    addBase({
      '*': {
        'border-color': 'var(--border)',
      },
    });
  },
  {
    theme: {
      extend: {
        colors: {
          background: 'var(--background)',
          foreground: 'var(--foreground)',
          primary: {
            DEFAULT: 'var(--primary)',
            foreground: 'var(--primary-foreground)',
          },
          secondary: {
            DEFAULT: 'var(--secondary)',
            foreground: 'var(--secondary-foreground)',
          },
          muted: {
            DEFAULT: 'var(--muted)',
            foreground: 'var(--muted-foreground)',
          },
          accent: {
            DEFAULT: 'var(--accent)',
            foreground: 'var(--accent-foreground)',
          },
          destructive: {
            DEFAULT: 'var(--destructive)',
            foreground: 'var(--destructive-foreground)',
          },
          border: 'var(--border)',
          input: 'var(--input)',
          ring: 'var(--ring)',
          card: {
            DEFAULT: 'var(--card)',
            foreground: 'var(--card-foreground)',
          },
        },
        borderRadius: {
          lg: 'var(--radius)',
          md: 'calc(var(--radius) - 2px)',
          sm: 'calc(var(--radius) - 4px)',
        },
      },
    },
  },
);
