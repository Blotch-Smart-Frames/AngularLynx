import type { CSSProperties, FC, HTMLAttributes, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

/**
 * Rspress passes SVG sizes as unitless numbers or numeric strings
 * (`width="16"`), which mean pixels on an `<svg>` but nothing in a CSS custom
 * property.
 */
const toCssLength = (size: string | number) =>
  typeof size === 'number' || /^\d+(\.\d+)?$/.test(size) ? `${size}px` : size;

/**
 * Builds a replacement for one of Rspress's built-in SVG icons that draws a
 * Font Awesome glyph instead.
 *
 * Rspress's CSS sizes its icons as boxes: each SVG has an intrinsic size, and
 * the stylesheet of the component using it overrides that with `width` and
 * `height`. The span stands in for the SVG box (see `.rp-fa-icon` in
 * index.scss), so every place Rspress puts an icon keeps its layout, and the
 * glyph inside scales to the box the way an SVG's paths scale to its viewBox.
 *
 * @param name Font Awesome icon name, without the `fa-` prefix.
 * @param size The replaced SVG's intrinsic size, used where Rspress's CSS
 *   doesn't size the icon itself.
 */
const faIcon = (
  name: string,
  size: string | number = '1em',
  { family = 'fa-light', spin = false } = {},
): FC<IconProps> => {
  const Icon: FC<IconProps> = ({
    className,
    width,
    height,
    fontSize,
    style,
    ...rest
  }) => (
    <span
      // Rspress only passes event handlers beyond the props picked out above,
      // and those work the same on a span as on an SVG.
      {...(rest as HTMLAttributes<HTMLSpanElement>)}
      className={className ? `rp-fa-icon ${className}` : 'rp-fa-icon'}
      style={
        {
          '--rp-fa-icon-size': toCssLength(height ?? width ?? size),
          fontSize,
          ...style,
        } as CSSProperties
      }
    >
      <i
        className={`${family} fa-${name}${spin ? ' fa-spin' : ''}`}
        aria-hidden="true"
      />
    </span>
  );
  Icon.displayName = `FaIcon(${name})`;
  return Icon;
};

// Rspress's components import these names from `@rspress/core/theme`, which
// resolves to this theme first, so these replace its icons site-wide. Each
// size is the intrinsic size of the Rspress SVG it replaces.
export const IconArrowDown = faIcon('chevron-down');
export const IconArrowRight = faIcon('chevron-right');
export const IconClose = faIcon('xmark', 24);
export const IconCopy = faIcon('copy', 32);
export const IconDeprecated = faIcon('trash-can');
export const IconDown = faIcon('chevron-down');
export const IconEdit = faIcon('pen-to-square');
export const IconEmpty = faIcon('inbox', 48);
export const IconExperimental = faIcon('flask');
export const IconExternalLink = faIcon('arrow-up-right-from-square', 16);
export const IconFile = faIcon('file-magnifying-glass', 24);
export const IconGithub = faIcon('github', '1em', { family: 'fa-brands' });
export const IconGitlab = faIcon('gitlab', '1em', { family: 'fa-brands' });
export const IconHeader = faIcon('hashtag', 24);
export const IconJump = faIcon('arrow-turn-down', 24);
export const IconLink = faIcon('link', 24);
export const IconLoading = faIcon('spinner-third', 32, { spin: true });
export const IconMenu = faIcon('sidebar');
export const IconMoon = faIcon('moon', 19);
export const IconScrollToTop = faIcon('circle-chevron-up');
export const IconSearch = faIcon('magnifying-glass');
export const IconSmallMenu = faIcon('bars', 21);
export const IconSuccess = faIcon('check', 32);
export const IconSun = faIcon('sun-bright', 24);
export const IconTitle = faIcon('file-lines', 24);
// The code block's wrap toggle shows IconWrap while off and IconWrapped, in
// green, while on. Font Awesome has no icon for unwrapped text, so both use
// the return arrow, the usual symbol for word wrap, and the color shows the
// state.
export const IconWrap = faIcon('arrow-turn-down-left', 32);
export const IconWrapped = faIcon('arrow-turn-down-left', 32);
