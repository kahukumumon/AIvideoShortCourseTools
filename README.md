# AIVideoShortCourseTool

`index.html` をそのまま GitHub Pages で公開するための最小構成です。

## 公開方法

1. GitHub で `AIVideoShortCourseTool` という名前の空リポジトリを作る
2. このフォルダをそのリポジトリに push する
3. 初回だけ GitHub の `Settings > Pages` で `Build and deployment` を `GitHub Actions` にする
4. その後 `main` ブランチへ push すると Pages が自動デプロイされる

## 初回デプロイで `Get Pages site failed` が出る場合

そのエラーは、リポジトリで GitHub Pages がまだ有効化されていない状態です。

- 一番簡単な対応:
  GitHub の `Settings > Pages` を開き、`Build and deployment` を `GitHub Actions` にする
- 自動有効化したい場合:
  リポジトリ secret `PAGES_PAT` を追加する
  fine-grained PAT なら `Pages: write` を含む権限、classic PAT なら `repo` scope を付ける

この workflow は `PAGES_PAT` がある場合だけ `configure-pages` の `enablement` を使って自動有効化を試みます。secret がない場合は、手動で 1 回有効化してください。

## ローカル確認

`file:` では `ffmpeg.wasm` の初期化が止まりやすいので、確認時は簡易サーバーを使ってください。

```powershell
cd c:\data\code\AIvideoShortTheminer
py -m http.server 8123
```

その後、`http://127.0.0.1:8123/` を開きます。
