import { render } from '@testing-library/react-native';

import { Icon } from '@/components/icon';

describe('Icon', () => {
  it('読み上げからは外し、Svg には Web の DOM に漏れる RN 専用の属性を渡さない', () => {
    const { toJSON } = render(<Icon name="check" />);
    const json = JSON.stringify(toJSON());
    expect(json).toContain('"aria-hidden":true');
    expect(json).not.toContain('importantForAccessibility');
    expect(json).not.toContain('accessibilityElementsHidden');
  });
});
