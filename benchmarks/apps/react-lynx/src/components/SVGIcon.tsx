import heart from '../assets/icons/heart.svg?raw';
import heartSolid from '../assets/icons/heart-solid.svg?raw';
import home from '../assets/icons/home.svg?raw';
import homeSolid from '../assets/icons/home-solid.svg?raw';

export const Icons = { heart, heartSolid, home, homeSolid };

interface Props {
  icon: string;
  size?: number;
  color?: string;
}

/**
 * The original's SVGs (react-native-svg through react-native-svg-transformer)
 * drawn by Lynx's `<svg>` element (XElement, which the shell registers). The
 * original fills them with `fill={color}`; here the color goes into the
 * markup, which the element draws as it is.
 */
export function SVGIcon({ icon, size = 20, color = '#000000' }: Props) {
  const content = icon.replace('<svg ', `<svg fill="${color}" `);
  return <svg content={content} style={{ width: `${size}px`, height: `${size}px` }} />;
}
