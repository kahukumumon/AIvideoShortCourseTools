# AIVideoShortCourseTool

`index.html` をそのまま GitHub Pages で公開するための最小構成です。

## 公開方法

1. GitHub で `AIVideoShortCourseTool` という名前の空リポジトリを作る
2. このフォルダをそのリポジトリに push する
3. GitHub の `Settings > Pages` で `Build and deployment` を `GitHub Actions` にする
4. `main` ブランチへ push すると Pages が自動デプロイされる

## ローカル確認

`file:` では `ffmpeg.wasm` の初期化が止まりやすいので、確認時は簡易サーバーを使ってください。

```powershell
cd c:\data\code\AIvideoShortTheminer
py -m http.server 8123
```

その後、`http://127.0.0.1:8123/` を開きます。
