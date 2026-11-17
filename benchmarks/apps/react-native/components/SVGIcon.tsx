import type { SvgProps } from 'react-native-svg';

export type SvgComponent = React.ComponentType<SvgProps>;

interface Props {
  icon: SvgComponent;
  size?: number;
  color?: string;
}

export function SVGIcon({ icon: IconComponent, size = 20, color = '#000000' }: Props) {
  return <IconComponent width={size} height={size} fill={color} />;
}
