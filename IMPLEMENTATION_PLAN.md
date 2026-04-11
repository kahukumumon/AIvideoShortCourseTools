# 複数動画・シークバー統合・RMSグラフ 実装計画

## Phase 1: 型定義拡張 (types.ts)

### AudioClip拡張
- RMSグラフ配列: rmsGraph?: number[] (10msごとのRMS値、-80dBから0dBへ正規化)

### App.tsx状態管理
- videoSource → videoSources: MediaSourceItem[]
- playhead: 統一（保持）
- 複数ファイル受け入れ処理

## Phase 2: RMS計算・キャッシュ
- lib/rms.ts: computeRmsGraph関数
- OfflineAudioContextで計算

## Phase 3: RMS描画
- RmsGraph.tsx: Canvas描画コンポーネント

## Phase 4: テスト
- ユニット・E2Eテスト追加

## 実装順序
1. types.ts
2. App.tsx
3. lib/rms.ts
4. RmsGraph.tsx
5. テスト
6. ビルド確認
