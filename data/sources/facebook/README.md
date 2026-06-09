# Facebook source folders

Put page-specific knowledge in these folders:

- `1184640711390003` -> Synco
- `260016447958834` -> Viltrox

Each folder can contain:

- `source.json`
- `products.csv`
- `faq.md`
- `policies.md`
- `catalog_summary.md`

`source.json` can also enable official web guidance for product setup questions:

```json
{
  "displayName": "Viltrox",
  "brand": "Viltrox",
  "strictProducts": true,
  "webGuidance": {
    "enabled": true,
    "allowedDomains": ["viltrox.com"],
    "maxResults": 3
  }
}
```

The app will prefer the page folder first, then fall back to `facebook/` and `common/` if needed.

For Facebook product catalogs, each configured page is isolated. If a page folder has no `products.csv`, the app returns no products instead of using the shared catalog.

Generate the page-specific product files from `data/products.csv`:

```bash
npm run split-facebook-products
```

For additional pages, pass one or more `pageId:brand` mappings:

```bash
npm run split-facebook-products -- 123456789:Viltrox 987654321:Maono
```
