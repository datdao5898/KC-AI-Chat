# KingCom AI Agent

AI CSKH da kenh: Facebook Messenger, Zalo OA, Haravan Website.

## Chay local

```bash
cp .env.example .env
npm install
npm run init-db
npm start
```

App runtime dung PostgreSQL. Dien `DATABASE_URL` trong `.env` truoc khi chay
`npm run init-db`. Neu dang nang cap tu ban SQLite cu, chay mot lan:

```bash
npm run migrate-sqlite-to-postgres
```

Xem huong dan tao database, migrate va backup tai `POSTGRESQL.md`.

File `legacy/sqliteLegacyDb.js` chi giu lai nhu ma legacy, khong dung cho production deploy.

Mo dashboard: http://localhost:8650

Dashboard se hien man hinh dang nhap. Dat `ADMIN_USERNAME` va `ADMIN_PASSWORD_HASH`
trong `.env` truoc khi chay app. Co the tao hash bang:

```bash
npm run hash-admin-password -- "mat-khau-manh-cua-anh"
```

## Webhook URLs

Neu dung ngrok/Cloudflare tro vao port `8650`:

- Facebook: `https://YOUR_DOMAIN/webhooks/facebook`
- Zalo OA: `https://YOUR_DOMAIN/webhooks/zalo`
- Haravan: `https://YOUR_DOMAIN/webhooks/haravan`
- Website widget API: `https://YOUR_DOMAIN/webhooks/website-chat`

Webhook signature duoc bat mac dinh bang `REQUIRE_WEBHOOK_SIGNATURES=true`.
Dien cac secret tuong ung trong `.env`: `FACEBOOK_APP_SECRET`, `ZALO_APP_SECRET`,
`HARAVAN_WEBHOOK_SECRET`. Chi tat signature khi test local.

## CORS va dashboard

- `ADMIN_USERNAME`: user dang nhap dashboard.
- `ADMIN_PASSWORD_HASH`: hash mat khau admin, nen dung tren VPS/production.
- `ADMIN_PASSWORD`: fallback de setup nhanh, khong nen dung lau dai.
- `ADMIN_SESSION_SECRET`: chuoi bi mat de ky session cookie.
- `ADMIN_COOKIE_SECURE`: dat `true` neu dashboard chi chay qua HTTPS.
- `ADMIN_TOKEN`: fallback cu cho script/API neu can.
- `CORS_ORIGINS`: danh sach origin duoc phep goi cross-origin, phan tach bang dau phay.
- `PUBLIC_BASE_URL`: domain public dung trong link alert gui nhan vien.

## Lark alerts

- `LARK_RECEIVE_IDS`: danh sach `chat_id` cua cac group can nhan alert, phan tach bang dau phay.
- `LARK_RECEIVE_ID`: fallback neu chi dung 1 group.
- Neu can gui vao 2 group, chi can dien ca hai ID vao `LARK_RECEIVE_IDS`.

## OpenAI

App goi OpenRouter/OpenAI truc tiep, khong can CLI trung gian.

- `OPENAI_API_KEY` hoac `OPENROUTER_API_KEY`: API key cua anh.
- `OPENAI_MODEL`: mac dinh `gpt-5.4-mini`, hoac `openrouter/owl-alpha` neu anh dung OpenRouter.
- `OPENAI_BASE_URL`: mac dinh `https://api.openai.com/v1`, doi sang `https://openrouter.ai/api/v1` neu anh dung OpenRouter.
- `REPLY_JUDGE_ENABLED`: bat/tat tang Conversation Auditor kiem tra cau tra loi truoc khi gui cho khach.
- `OPENAI_JUDGE_MODEL`: de trong thi dung chung model voi `OPENAI_MODEL`; dien model khac neu muon tang judge rieng.
- `OPENAI_JUDGE_MAX_OUTPUT_TOKENS`: ngan sach token cho Judge, nen de `1200`; lan retry se tu tang them de tranh reasoning chiem het output.
- `OPENAI_JUDGE_RETRIES`: so lan thu lai neu judge tra JSON loi, mac dinh `2`.
- `PRODUCT_GUIDANCE_WEB_SEARCH_ENABLED`: kill switch toan cuc. Dat `false` de tat web guidance cho tat ca source; neu bo trong thi moi source bat/tat rieng trong `source.json`.
- `PRODUCT_GUIDANCE_WEB_SEARCH_MODEL`: model dung cho huong dan co tim web; de trong thi dung `OPENAI_MODEL`.
- `PRODUCT_GUIDANCE_WEB_SEARCH_MAX_RESULTS`: so nguon chinh hang toi da, mac dinh `3`.
- `PRODUCT_GUIDANCE_WEB_SEARCH_TIMEOUT_MS`: timeout rieng cho web guidance; de trong thi dung `AI_TIMEOUT_MS`.

Neu anh muon thu model khac, chi can doi `OPENAI_MODEL`.

### Huong dan su dung san pham tu website hang

Khi khach hoi cach dung, ket noi, cai dat hoac pairing mot san pham co trong catalog, app uu tien dung dung san pham RAG da tim thay, sau do co the tim tai cac domain chinh hang duoc khai bao trong `data/sources/<source>/source.json`. Voi source co nhieu thuong hieu, `brandDomains` tiep tuc thu hep ket qua theo `vendor/brand` cua san pham RAG.

Web search khong duoc dung de tra loi gia, ton kho, khuyen mai, VAT, giao hang hoac chinh sach cua cua hang. Cau tra loi chi duoc chap nhan khi OpenRouter tra ve citation thuoc allowlist cua source.

## Nhip tra loi tu nhien

App co delay nhe truoc khi gui cau tra loi de khach khong thay bot tra loi qua nhanh.
Co the chinh trong `.env`:

```env
HUMAN_REPLY_DELAY_ENABLED=true
HUMAN_REPLY_DELAY_MIN_MS=900
HUMAN_REPLY_DELAY_MAX_MS=6500
HUMAN_REPLY_DELAY_MS_PER_CHAR=10
HUMAN_REPLY_DELAY_MS_PER_LINE=220
HUMAN_REPLY_DELAY_JITTER_MS=500
```

## Tu dong tom tat hoi thoai

Dashboard tu cap nhat tom tat sau moi tin nhan neu bat:

```env
AUTO_SUMMARY=true
AUTO_AI_SUMMARY=true
AUTO_SUMMARY_DELAY_MS=250
AUTO_SUMMARY_RETRIES=2
AUTO_SUMMARY_RETRY_DELAY_MS=500
```

Neu AI tom tat bi timeout/loi provider, app thu lai theo `AUTO_SUMMARY_RETRIES`, sau do moi dung tom tat nhanh noi bo. Neu muon tiet kiem token, dat `AUTO_AI_SUMMARY=false`.

`OPENAI_MAX_ATTEMPTS` la tong so lan goi reply AI, bao gom lan dau. `OPENAI_EMPTY_RESPONSE_RETRIES` chi duoc giu de tuong thich voi cau hinh cu.

Dashboard doc toi da `JUDGE_METRICS_SAMPLE_SIZE` dong log AI gan nhat de hien thi ty le Judge tu choi; mac dinh la 1000.

Neu AI da xu ly lau hon muc delay muc tieu thi app se khong bat khach cho them.

## Du lieu hoc/RAG

Thay file:

- `data/products.csv` voi cot: `sku,name,vendor,price,description,tags`
- `data/faq.md`
- `data/policies.md`

Neu muon tach du lieu theo tung nguon, dung cau truc:

- `data/sources/website/newlite/`
- `data/sources/website/kingcom/`
- `data/sources/facebook/<pageId>/`
- `data/sources/zalo/<oaId>/`

App se uu tien doc file trong dung thu muc nguon truoc, sau do moi fallback ve du lieu chung.

## Nhung widget vao Haravan website

Them truoc `</body>`.

Website NewLite:

```html
<script src="https://YOUR_DOMAIN/widget.js" data-site-name="newlite"></script>
```

Website KingCom:

```html
<script src="https://YOUR_DOMAIN/widget.js" data-site-name="kingcom"></script>
```

Widget tu hien thi `NewLite` hoac `KingCom` theo `data-site-name`.

Nho them domain storefront vao `CORS_ORIGINS`, vi du:

```env
CORS_ORIGINS=https://your-store.myharavan.com,https://kingcom.vn
```

Dashboard se gom hoi thoai website theo `data-site-name` hoac domain hien tai.
Neu co nhieu site nhu `newlite` va `kingcom`, gan moi site mot `data-site-name`
khac nhau de sidebar hien dung nhom con.

Neu co nhieu fanpage/OA, co the dat ten hien thi trong `.env`:

```env
FACEBOOK_PAGE_TOKENS=260016447958834:token_page_1,123456789:token_page_2
FACEBOOK_PAGE_NAMES=260016447958834:Page 1,123456789:Page 2
ZALO_OA_NAMES=oa_id_1:KingCom Zalo,oa_id_2:Newlite Zalo
```

Khi Facebook webhook gui tin nhan ve, app se doc `recipient.id` lam `pageId` va chon token tu `FACEBOOK_PAGE_TOKENS`. Neu khong thay token rieng cho page do, app fallback ve `FACEBOOK_PAGE_ACCESS_TOKEN`.
