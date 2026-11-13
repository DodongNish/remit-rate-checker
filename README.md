# JPY → PHP 送金レート比較

SBI Remit / Smiles / D-com / City Express の JPY→PHP レートを毎時取得し、GitHub Pages に表示します。

- `scraper/fetch.py` : 各社のレート取得 → `public/rates.json`
- `web/index.html`   : 表示ページ
- `.github/workflows/rates.yml` : 定期実行とデプロイ

Settings → Pages → Source を「GitHub Actions」にしてください。
