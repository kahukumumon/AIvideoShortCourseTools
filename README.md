# AIVideoShortCourseTool

静的サイトとして配信するツール集です。既存の HTML ツールに加えて、React + Vite で実装した動画編集ツールを含みます。

## 含まれるツール

- 動画連結
- うごイラ
- pixivリサイズ
- オリキャラ設定
- 動画編集

## 動画編集ツール

動画編集ツールは [src/video-edit-app](src/video-edit-app) で開発し、配信用ビルド成果物を [tools/video_edit](tools/video_edit) に出力します。

対応している MVP 機能:

- 無音動画 1 本と複数音声トラックの編集
- 再生、停止、シーク
- クリップ移動
- Shift+端ドラッグによるトリミング
- 端ドラッグによる速度変更
- 分割、削除、結合
- フェードイン、フェードアウト
- 音声クリップ個別音量とトラック一括音量
- mp4 エクスポート

## セットアップ

1. Node.js 24 系を用意する
2. 依存関係をインストールする

```powershell
cd c:\data\code\AIvideoShortTheminer
npm install
```

## 開発コマンド

```powershell
npm run dev
npm run test
npm run build
```

- 開発サーバー: Vite
- テスト: Vitest
- 本番ビルド出力先: tools/video_edit

## ローカル確認

既存の静的トップページ確認:

```powershell
cd c:\data\code\AIvideoShortTheminer
py -m http.server 8123
```

その後、http://127.0.0.1:8123/ を開きます。

React アプリ単体の開発確認:

```powershell
cd c:\data\code\AIvideoShortTheminer
npm run dev
```

## GitHub Pages

GitHub Pages ではリポジトリ全体をそのまま配信し、動画編集ツールは tools/video_edit 配下の静的成果物を参照します。build 後の成果物を含めてデプロイしてください。
