import {
  computeConnector,
  computeCrop,
  cropAspectRatio,
  getTemplate,
  resolveLabelStyle,
  visibleLines,
  type TemplateDefinition,
} from '@coordinate/layout';
import type { EditDocument, Label } from '@coordinate/shared';
import { Image } from 'expo-image';
import { useCallback, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Circle, Path } from 'react-native-svg';

import { LabelChip } from './label-chip';
import type { Photo } from './reducer';

export type CanvasHandlers = {
  onSelect: (id: string | null) => void;
  /** ドラッグなど連続操作の開始(履歴に1回だけ積む)。 */
  onBegin: () => void;
  /** ドラッグの差分(正規化座標)。ラベル本体(position)か線の指し先(anchor)を動かす。 */
  onMoveLabel: (id: string, target: 'position' | 'anchor', dx: number, dy: number) => void;
  onPanCrop: (dx: number, dy: number) => void;
};

type Props = {
  photo: Photo;
  doc: EditDocument;
  /** キャンバスの幅(dp)。高さはトリミング比率から決まる。 */
  width: number;
  selectedId?: string | null;
  /** 写真をドラッグしてトリミング位置を動かすモード。 */
  cropMode?: boolean;
  /** 操作ハンドラ。渡さなければ表示専用(書き出し用)。 */
  handlers?: CanvasHandlers;
};

type Size = { w: number; h: number };

const HANDLE = 14;

/** 写真 + ラベル + 線。表示専用でも編集可能でも同じ描画なので、プレビューと書き出し結果が一致する。 */
export function EditorCanvas({ photo, doc, width, selectedId = null, cropMode = false, handlers }: Props) {
  const template = getTemplate(doc.templateId);
  const crop = doc.crop ?? computeCrop(photo.width, photo.height, doc.aspect);
  const height = width / cropAspectRatio(crop, photo.width, photo.height);
  const unit = width / 360;
  const [sizes, setSizes] = useState<Record<string, Size>>({});

  const onLabelLayout = useCallback((id: string, e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    setSizes((prev) => {
      const old = prev[id];
      return old && Math.abs(old.w - w) < 0.5 && Math.abs(old.h - h) < 0.5 ? prev : { ...prev, [id]: { w, h } };
    });
  }, []);

  const drawW = width / crop.w;
  const drawH = height / crop.h;

  const cropPan = Gesture.Pan()
    .runOnJS(true)
    .enabled(cropMode && !!handlers)
    .onStart(() => handlers?.onBegin())
    .onChange((e) => handlers?.onPanCrop((-e.changeX * crop.w) / width, (-e.changeY * crop.h) / height));

  const background = Gesture.Tap()
    .runOnJS(true)
    .enabled(!!handlers)
    .onEnd(() => handlers?.onSelect(null));

  const visible = doc.labels.filter((l) => visibleLines(l, doc.showPrices));

  return (
    <View style={{ width, height, overflow: 'hidden', backgroundColor: '#222' }} collapsable={false}>
      <GestureDetector gesture={Gesture.Race(cropPan, background)}>
        <View style={StyleSheet.absoluteFill}>
          <Image
            source={{ uri: photo.uri }}
            contentFit="fill"
            style={{ position: 'absolute', width: drawW, height: drawH, left: -crop.x * drawW, top: -crop.y * drawH }}
          />
        </View>
      </GestureDetector>

      <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
        {visible.map((l) => (
          <Connector key={l.id} label={l} template={template} width={width} height={height} unit={unit} size={sizes[l.id]} />
        ))}
      </Svg>

      {visible.map((l) => (
        <DraggableLabel
          key={l.id}
          label={l}
          template={template}
          showPrices={doc.showPrices}
          width={width}
          height={height}
          unit={unit}
          selected={selectedId === l.id}
          interactive={!!handlers && !cropMode}
          handlers={handlers}
          onLayout={onLabelLayout}
        />
      ))}

      {handlers && !cropMode && selectedId
        ? visible
            .filter((l) => l.id === selectedId)
            .map((l) => <AnchorHandle key={l.id} label={l} width={width} height={height} handlers={handlers} />)
        : null}
    </View>
  );
}

function Connector({
  label,
  template,
  width,
  height,
  unit,
  size,
}: {
  label: Label;
  template: TemplateDefinition;
  width: number;
  height: number;
  unit: number;
  size: Size | undefined;
}) {
  if (!size) return null;
  const s = resolveLabelStyle(template, label);
  if (s.lineWidth <= 0) return null;
  const rect = { x: label.position.x * width, y: label.position.y * height, w: size.w, h: size.h };
  const c = computeConnector(rect, { x: label.anchor.x * width, y: label.anchor.y * height }, s.arrow, unit);
  const sw = s.lineWidth * unit;
  return (
    <>
      <Path d={c.path} stroke={s.lineColor} strokeWidth={sw} strokeLinecap="round" fill="none" />
      {c.head ? (
        <Path
          d={`M ${c.head[0].x} ${c.head[0].y} L ${c.head[1].x} ${c.head[1].y} L ${c.head[2].x} ${c.head[2].y}`}
          stroke={s.lineColor}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      ) : null}
      {c.dot ? <Circle cx={c.end.x} cy={c.end.y} r={3.2 * unit + sw / 2} fill={s.lineColor} /> : null}
    </>
  );
}

function DraggableLabel({
  label,
  template,
  showPrices,
  width,
  height,
  unit,
  selected,
  interactive,
  handlers,
  onLayout,
}: {
  label: Label;
  template: TemplateDefinition;
  showPrices: boolean;
  width: number;
  height: number;
  unit: number;
  selected: boolean;
  interactive: boolean;
  handlers: CanvasHandlers | undefined;
  onLayout: (id: string, e: LayoutChangeEvent) => void;
}) {
  const pan = Gesture.Pan()
    .runOnJS(true)
    .enabled(interactive)
    .minDistance(3)
    .onStart(() => {
      handlers?.onSelect(label.id);
      handlers?.onBegin();
    })
    .onChange((e) => handlers?.onMoveLabel(label.id, 'position', e.changeX / width, e.changeY / height));
  const tap = Gesture.Tap()
    .runOnJS(true)
    .enabled(interactive)
    .onEnd(() => handlers?.onSelect(label.id));

  return (
    <GestureDetector gesture={Gesture.Race(pan, tap)}>
      <View style={{ position: 'absolute', left: label.position.x * width, top: label.position.y * height }}>
        <LabelChip
          label={label}
          template={template}
          showPrices={showPrices}
          unit={unit}
          selected={selected && interactive}
          onLayout={(e) => onLayout(label.id, e)}
        />
      </View>
    </GestureDetector>
  );
}

/** 線の指し先(アイテム側の端点)をドラッグするハンドル。 */
function AnchorHandle({
  label,
  width,
  height,
  handlers,
}: {
  label: Label;
  width: number;
  height: number;
  handlers: CanvasHandlers;
}) {
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(1)
    .onStart(() => handlers.onBegin())
    .onChange((e) => handlers.onMoveLabel(label.id, 'anchor', e.changeX / width, e.changeY / height));
  const hit = 44;
  return (
    <GestureDetector gesture={pan}>
      <View
        style={{
          position: 'absolute',
          left: label.anchor.x * width - hit / 2,
          top: label.anchor.y * height - hit / 2,
          width: hit,
          height: hit,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <View style={styles.handle} />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  handle: {
    width: HANDLE,
    height: HANDLE,
    borderRadius: HANDLE / 2,
    backgroundColor: '#3D8BFF',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
});
