# JPY → PHP 送金レート比較

SBI Remit / Smiles / D-com / City Express の JPY→PHP レートを比較する GitHub Pages サイトです。Smiles / D-com / City Express は、ページを開く・再読み込みするたびに Cloudflare Worker 経由で公式サイトから取得します。

## 構成

- `web/index.html` : GitHub Pages の表示画面
- `worker/src/index.js` : 各社の公式ページを取得してレートを返す API
- `wrangler.toml` : Cloudflare Worker の設定
- `.github/workflows/rates.yml` : GitHub Pages のデプロイのみ（レート取得はしません）
- `scraper/fetch.py` : 旧 GitHub Actions 方式のスクレイパー（現在は未使用）

## セットアップ

### 1. Cloudflare Worker をデプロイ

Node.js と npm が使える環境でリポジトリを clone し、次を実行します。

```bash
npm install -g wrangler
npx wrangler login
npx wrangler deploy
```

デプロイ後、`https://<worker-name>.<your-subdomain>.workers.dev` の URL が表示されます。

### 2. GitHub Pages の API URL を設定

`web/index.html` の次の行を、デプロイ時に表示された URL に置き換えてください。

```js
const API_URL = "https://YOUR-WORKER-NAME.YOUR-SUBDOMAIN.workers.dev";
```

変更を `main` に push すると GitHub Actions が Pages を更新します。

### 3. 動作確認

ブラウザで次の URL を開き、JSON が返ることを確認します。

```
https://<worker-name>.<your-subdomain>.workers.dev/api/rates
```

ページを再読み込みすると、その都度 Worker が各社の公式ページを取得します。各社サイトの仕様変更・アクセス制限・JavaScript による描画などにより、個別の取得に失敗する場合があります。その場合も取得できた会社のレートは表示し、失敗した会社は画面に表示します。

## 注意

- 取得レートは参考値です。送金手数料は含みません。
- 公式サイトへのアクセス可否や HTML 構造は各社側の変更に影響されます。
- Cloudflare Worker の URL はアカウントごとに異なるため、上記の `API_URL` は必ず実際の URL に変更してください。
