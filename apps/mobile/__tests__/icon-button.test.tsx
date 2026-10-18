import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { IconButton, TOOLTIP_MS } from '@/components/icon-button';

describe('IconButton', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('読み上げ名つきのボタンで、押すと onPress が呼ばれる', () => {
    const onPress = jest.fn();
    render(<IconButton icon="plus" accessibilityLabel="写真を選ぶ" onPress={onPress} />);
    fireEvent.press(screen.getByLabelText('写真を選ぶ'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '写真を選ぶ' })).toBeTruthy();
  });

  it('無効のときは押せない', () => {
    const onPress = jest.fn();
    render(<IconButton icon="plus" accessibilityLabel="写真を選ぶ" onPress={onPress} disabled />);
    fireEvent.press(screen.getByLabelText('写真を選ぶ'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('長押しで名前を一時表示し、数秒で消える', () => {
    render(<IconButton icon="settings" accessibilityLabel="設定" onPress={jest.fn()} />);
    expect(screen.queryByText('設定')).toBeNull();
    fireEvent(screen.getByLabelText('設定'), 'longPress');
    expect(screen.getByText('設定')).toBeTruthy();
    act(() => {
      jest.advanceTimersByTime(TOOLTIP_MS + 10);
    });
    expect(screen.queryByText('設定')).toBeNull();
  });

  it('selected を渡すと選択状態が読み上げられる', () => {
    render(<IconButton icon="text" accessibilityLabel="ラベル" onPress={jest.fn()} selected />);
    expect(screen.getByLabelText('ラベル').props.accessibilityState).toMatchObject({ selected: true });
  });
});
