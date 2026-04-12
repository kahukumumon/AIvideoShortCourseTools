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

GitHub Pages の公開は GitHub Actions で行います。`main` へ push すると workflow が `npm ci` と `npm run build` を実行し、生成した `tools/video_edit` を含む静的ファイルを Pages にデプロイします。

リリース手順:

1. `src/video-edit-app` などソース側の変更を commit して `main` へ push する
2. GitHub Actions の `Deploy Pages` が成功することを確認する
3. 公開後は `https://<user>.github.io/<repo>/tools/video_edit/` で反映を確認する

補足:

- `tools/video_edit` は Vite のビルド出力先ですが、Pages 公開のためにローカルで生成物を commit する運用は必須ではありません
- ローカルで事前確認したい場合は `npm run build` 実行後に `py -m http.server 8123` でリポジトリ全体を配信して確認できます
