import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type IconName =
  | 'plus'
  | 'search'
  | 'edit'
  | 'trash'
  | 'text'
  | 'contrast'
  | 'frame'
  | 'share'
  | 'arrowRight'
  | 'check'
  | 'similar'
  | 'settings'
  | 'close'
  | 'back';

type Props = {
  name: IconName;
  size?: number;
  color?: string;
  /** 線幅(viewBox 24 基準)。既定は極細の 1.2。 */
  strokeWidth?: number;
};

/** 極細の線アイコン。装飾なので読み上げからは外す(名前は親のボタンが持つ)。 */
export function Icon({ name, size = 24, color = '#F4F1EC', strokeWidth = 1.2 }: Props) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      {shape(name)}
    </Svg>
  );
}

function shape(name: IconName) {
  switch (name) {
    case 'plus':
      return <Path d="M12 5v14M5 12h14" />;
    case 'search':
      return (
        <>
          <Circle cx={11} cy={11} r={6.5} />
          <Path d="M16 16l4.5 4.5" />
        </>
      );
    case 'edit':
      return (
        <>
          <Path d="M4 20l1-4L16.5 4.5a1.8 1.8 0 012.5 0l.5.5a1.8 1.8 0 010 2.5L8 19z" />
          <Path d="M14.5 6.5l3 3" />
        </>
      );
    case 'trash':
      return <Path d="M4.5 7h15M10 4h4M6.5 7l.8 12a1 1 0 001 .9h7.4a1 1 0 001-.9l.8-12M10 11v5M14 11v5" />;
    case 'text':
      return <Path d="M5 6.5V5h14v1.5M12 5v14M9.5 19h5" />;
    case 'contrast':
      return (
        <>
          <Circle cx={12} cy={12} r={8} />
          <Path d="M12 4a8 8 0 010 16z" />
        </>
      );
    case 'frame':
      return (
        <>
          <Rect x={5} y={5} width={14} height={14} rx={2.5} />
          <Path d="M9 9h6v6H9z" />
        </>
      );
    case 'share':
      return <Path d="M12 15V4M8 7.5L12 3.5l4 4M6 11H5.5A1.5 1.5 0 004 12.5v6A1.5 1.5 0 005.5 20h13a1.5 1.5 0 001.5-1.5v-6a1.5 1.5 0 00-1.5-1.5H18" />;
    case 'arrowRight':
      return <Path d="M5 12h14M13.5 6.5L19 12l-5.5 5.5" />;
    case 'check':
      return <Path d="M5 12.5l4.5 4.5L19 7.5" />;
    case 'similar':
      return <Path d="M4.5 9.5c2-2.5 3.5-2.5 5.5 0s3.5 2.5 5.5 0 2.5-2 4-.5M4.5 16c2-2.5 3.5-2.5 5.5 0s3.5 2.5 5.5 0 2.5-2 4-.5" />;
    case 'settings':
      return <Path d="M4 7h9M17 7h3M4 17h3M11 17h9M15 4.5v5M9 14.5v5" />;
    case 'close':
      return <Path d="M6 6l12 12M18 6L6 18" />;
    case 'back':
      return <Path d="M19 12H5M10.5 6.5L5 12l5.5 5.5" />;
  }
}
