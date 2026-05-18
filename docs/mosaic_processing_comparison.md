# `mosaic_tool` カメラワーク+モザイクと動画編集ツールのモザイク処理の違い

## 比較対象

- 旧実装: `C:\data\code\mosaic_tool`
  - 主対象: `src/components/editor-shell/lib/camera-and-mosaic.ts`
  - 画面: `カメラワーク+モザイク`
- 現行実装: `C:\data\code\AIvideoShortTheminer`
  - 主対象: `src/video-edit-app/src/lib/exportFfmpeg.ts`
  - プレビュー: `src/video-edit-app/src/App.tsx`
  - モザイクタイムライン: `src/video-edit-app/src/lib/timeline.ts`

このメモでは、React/Vite の動画編集ツール内モザイク処理を比較対象として扱う。静的ツール `tools/video_mosaic` の固定モザイクは補足として末尾に記載する。

2026-05-18 の移植後、動画編集ツール側のモザイク処理は、回転楕円/ffmpeg `geq` ではなく、2円カプセル形状と Canvas `ImageData` の平均ブロック処理を使う。以下の「現行動画編集ツール側の処理」は、移植前の差分分析として読む。

## 要約

`mosaic_tool` の `カメラワーク+モザイク` は、追跡JSONの2点円データからフレームごとのカプセル形状を作り、Canvas の `ImageData` を直接平均色ブロックへ書き換えたあと、カメラ矩形でクロップ/拡大して WebCodecs で再エンコードする。

移植前の動画編集ツールは、タイムライン上のモザイククリップごとに回転楕円マスクを持ち、エクスポート時は ffmpeg.wasm の `geq` フィルタで楕円内だけをピクセル化していた。プレビューは Canvas で近似表示するが、最終出力の処理本体は ffmpeg フィルタグラフ側にあった。

移植後の動画編集ツールは、カメラワーク/トラッキングは持ち込まず、モザイク形状とピクセル化方式だけを移植している。つまり、ユーザーがタイムライン上に置いた固定モザイククリップに対して、2点円カプセル形状を Canvas `ImageData` 平均ブロック処理で適用し、エクスポート時は WebCodecs でモザイク済み映像を再エンコードする。

## 主な違い

| 観点 | `mosaic_tool` カメラワーク+モザイク | 現行動画編集ツール |
| --- | --- | --- |
| モザイク形状 | 2点の円と外接線で作るカプセル形状 | 移植前: クリップごとの回転楕円 / 移植後: 2点円カプセル形状 |
| モザイク位置 | 追跡JSONの `frames[].pointA/pointB` に従い、フレームごとに変化 | モザイククリップの `mask` は固定値。時間範囲は変えられるが、同一クリップ内で位置のキーフレームはない |
| 座標系 | `long_edge` または `frame_size` 正規化座標を出力解像度へ復元 | 移植前: `cx/cy/rx/ry` / 移植後: `circleA/circleB` の中心は幅/高さ正規化、半径は長辺正規化 |
| ピクセル化 | Canvas `getImageData` / `putImageData` でブロック内の平均 RGBA を計算 | 移植前: ffmpeg `geq` のブロック中心サンプル / 移植後: Canvas `ImageData` の平均 RGBA |
| ブロックサイズ | 長辺の `1/100` を丸め、最低 4px | 移植後: 長辺の `1/100` を丸め、最低 4px |
| 適用順 | モザイクを元フレームへ適用してから、カメラ矩形で切り出し/拡大 | 動画クリップを concat した後、モザイクフィルタを適用。カメラワーク処理はない |
| 出力経路 | WebCodecs `VideoEncoder` + `mp4-muxer` | 移植前: ffmpeg.wasm `filter_complex` / 移植後: タイムライン合成後、Canvas モザイクを WebCodecs + `mp4-muxer` で再エンコードし、音声は ffmpeg で再結合 |
| 複数モザイク | 基本は読み込んだ1つの追跡ペイロードから1形状 | 複数トラック/複数クリップを順番にフィルタ適用。同時刻の複数楕円も可能 |

## `mosaic_tool` 側の処理

### 1. フレームごとの形状決定

`MosaicTrackingPayload` は `frames` 配列を持ち、各フレームに `pointA` / `pointB` を保持する。各点は `x`, `y`, `radius` を持つ。

`getMosaicGeometryByRatio` は動画全体の進捗 `ratio` を `frames` 配列の index に変換し、その時点の2点から `buildMosaicGeometry` を作る。`denormalizeTrackingPoint` で正規化座標を実ピクセルへ戻し、`computeOuterTangents` で2円の外接線を求める。

結果として、モザイク対象は以下の合成形状になる。

- 円Aの内部
- 円Bの内部
- 2本の外接線で囲まれた凸四角形

つまり、2つの円を接線でつないだカプセル型モザイクであり、一般的な楕円マスクではない。

### 2. ピクセル化方式

`applyMosaicShape` は対象形状の bounding box だけ `ImageData` を取得する。ブロックごとに形状内のピクセルだけを集計し、平均 `RGBA` を計算して、形状内のピクセルだけを平均色で置き換える。

重要な特徴:

- ブロックが形状の外側を含んでいても、平均計算に使うのは形状内のピクセルだけ。
- 書き戻しも形状内のピクセルだけ。
- アルファも平均対象。
- ブロックサイズは `Math.max(4, Math.round(longEdge / 100))`。

このため境界ブロックでは、形状外の色が平均に混ざらない。

### 3. カメラワークとの関係

`renderEditedVideoJsStreaming` では各デコードフレームに対して以下の順で処理する。

1. 元フレームを scratch canvas に描画。
2. `ratio` から現在のモザイク形状を取得。
3. scratch canvas 上の元解像度フレームへモザイクを適用。
4. カメラキーフレームを補間して、プレビュー座標からソース座標へ変換。
5. 指定カメラ矩形を出力 canvas 全体へ `drawImage` で拡大/縮小。
6. `VideoEncoder` へ投入。

つまりモザイクはカメラワーク前のソース座標系で適用される。カメラでズームしても、追跡座標とモザイクは元動画座標に紐づく。

## 移植前の動画編集ツール側の処理

### 1. モザイクデータ構造

現行の `MosaicClip` は `timelineStart`, `duration`, `mask` を持つ。`mask` は `EllipseMask` で、`cx`, `cy`, `rx`, `ry`, `angle` を保持する。

`MosaicTrack` は複数の `MosaicClip` を持ち、同一トラック内では重複しないよう `moveMosaicClip` / `trimMosaicClip` が配置を制御する。別トラック間の同時刻モザイクは許可される。

### 2. エクスポート時のピクセル化方式

エクスポート本体は `buildMosaicFilters` で ffmpeg の `geq` フィルタを組み立てる。

楕円判定は出力ピクセル座標で行う。

- `centerX = cx * videoWidth`
- `centerY = cy * videoHeight`
- `radiusX = rx * videoWidth`
- `radiusY = ry * videoHeight`
- `angle` で逆回転したローカル座標を使い、`x^2/rx^2 + y^2/ry^2 <= 1` を判定

楕円内の画素は、現在座標ではなくブロック中心の `lum/cb/cr` を参照する。

- `blockX = floor(X / ps) * ps + ps / 2`
- `blockY = floor(Y / ps) * ps + ps / 2`

つまり、平均色ではなく「ブロック中心サンプル」によるピクセル化である。

### 3. プレビュー時のピクセル化方式

プレビューは `App.tsx` の Canvas オーバーレイで描画される。現在フレームを canvas に描画し、アクティブなモザイククリップごとに回転楕円内のブロックを平均RGBで塗る。

ただし、プレビュー側はブロック中心が楕円内ならブロック全体を平均して塗るため、最終出力の ffmpeg `geq` とは完全一致しない。

主な差分:

- プレビュー: 平均RGBで置換。
- エクスポート: ブロック中心の YCbCr 成分を参照。
- プレビュー: ブロック中心が楕円内ならブロック全体を塗る。
- エクスポート: 各ピクセルごとに楕円内判定し、楕円外は元画素を維持。

## 実装上の意味

`mosaic_tool` の方式は、追跡データに追従する可変形状モザイクとカメラワーク出力が一体化している。対象が動いても `frames` の2点が更新される限り、モザイク位置もフレームごとに変わる。

現行方式は、動画編集タイムライン上で扱いやすい固定楕円クリップを優先している。複数クリップ、分割、結合、トラック管理、ffmpeg 出力と相性が良い一方、1クリップ内で対象を追跡する仕組みはない。

画質面では、`mosaic_tool` は形状内平均色を使うためブロックごとの色が安定しやすい。現行エクスポートはブロック中心サンプルのため高速でフィルタ化しやすいが、中心点が局所的に明暗差の強い場所だと平均方式より粗く見える可能性がある。

境界面では、`mosaic_tool` は形状内ピクセルのみ平均して形状内だけ書き戻す。現行エクスポートも楕円外は維持するが、色はブロック中心サンプルなので境界ブロックの見え方は異なる。現行プレビューは境界ブロックをまとめて塗るため、出力より境界が角張って見える可能性がある。

## 移植後の動画編集ツール側の処理

移植後は、カメラワークとトラッキングを持ち込まず、`mosaic_tool` のモザイク処理だけをタイムラインクリップに適用する。

- `MosaicClip.mask` は `circleA` / `circleB` を持つ2円カプセル形状。
- プレビューは `applyCapsuleMosaicToImageData` で、形状内ピクセルだけをブロック平均 RGBA に置換する。
- エクスポートは、まず既存 ffmpeg 経路でタイムライン映像と音声を合成し、その合成済み映像を Canvas `ImageData` でモザイク処理して WebCodecs `VideoEncoder` + `mp4-muxer` で再エンコードする。
- 最後に ffmpeg で WebCodecs 再エンコード済み映像と合成済み音声を stream copy で結合する。

このため、移植後の ffmpeg はモザイク形状やピクセル化を担当しない。ffmpeg の役割は、既存タイムライン合成と音声再結合に限定される。

## 補足: 静的 `tools/video_mosaic` との違い

現行リポジトリには `tools/video_mosaic` の固定モザイクもある。これは `assets/js/app.js` 側で2円カプセル型マスクを作り、プレビューでは canvas の縮小/拡大でピクセル化する。出力では ffmpeg にマスクPNGを渡し、元映像を縮小/最近傍拡大したモザイク映像を `alphamerge` / `overlay` する構造になっている。

この固定モザイクは形状だけ見ると `mosaic_tool` に近いが、追跡JSONやカメラキーフレームは持たず、全動画に同じ固定マスクを適用する点が異なる。
