# KingCom AI Agent

AI CSKH da kenh: Facebook Messenger, Zalo OA, Haravan Website.

## Chay local

```bash
cp .env.example .env
npm install
npm run init-db
npm start
```

Mo dashboard: http://localhost:8660

Dashboard se hoi `ADMIN_TOKEN`. Dat token nay trong `.env` truoc khi chay app.

## Webhook URLs

Neu dung ngrok/Cloudflare tro vao port `8660`:

- Facebook: `https://YOUR_DOMAIN/webhooks/facebook`
- Zalo OA: `https://YOUR_DOMAIN/webhooks/zalo`
- Haravan: `https://YOUR_DOMAIN/webhooks/haravan`
- Website widget API: `https://YOUR_DOMAIN/webhooks/website-chat`

Webhook signature duoc bat mac dinh bang `REQUIRE_WEBHOOK_SIGNATURES=true`.
Dien cac secret tuong ung trong `.env`: `FACEBOOK_APP_SECRET`, `ZALO_APP_SECRET`,
`HARAVAN_WEBHOOK_SECRET`. Chi tat signature khi test local.

## CORS va dashboard

- `ADMIN_TOKEN`: bat buoc de goi `/api`.
- `CORS_ORIGINS`: danh sach origin duoc phep goi cross-origin, phan tach bang dau phay.
- `PUBLIC_BASE_URL`: domain public dung trong link alert gui nhan vien.

## OpenAI

App goi OpenRouter/OpenAI truc tiep, khong can CLI trung gian.

- `OPENAI_API_KEY` hoac `OPENROUTER_API_KEY`: API key cua anh.
- `OPENAI_MODEL`: mac dinh `gpt-5.4-mini`, hoac `openrouter/owl-alpha` neu anh dung OpenRouter.
- `OPENAI_BASE_URL`: mac dinh `https://api.openai.com/v1`, doi sang `https://openrouter.ai/api/v1` neu anh dung OpenRouter.

Neu anh muon thu model khac, chi can doi `OPENAI_MODEL`.

## Du lieu hoc/RAG

Thay file:

- `data/products.csv` voi cot: `sku,name,vendor,price,description,tags`
- `data/faq.md`
- `data/policies.md`

## Nhung widget vao Haravan website

Them truoc `</body>`:

```html
<script src="https://YOUR_DOMAIN/widget.js"></script>
```

Nho them domain storefront vao `CORS_ORIGINS`, vi du:

```env
CORS_ORIGINS=https://your-store.myharavan.com,https://kingcom.vn
```
