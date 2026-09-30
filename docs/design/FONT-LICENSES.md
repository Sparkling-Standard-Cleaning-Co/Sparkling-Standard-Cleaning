# Font licenses

Both typefaces are self-hosted in `public/fonts/` and downloaded from Google Fonts by
`scripts/fetch-fonts.mjs`. Both are licensed under the **SIL Open Font License 1.1**, which
permits commercial use, self-hosting and redistribution with the license.

| Family | Files | License |
| --- | --- | --- |
| Fraunces (variable) | `fraunces-normal-latin.woff2` | SIL OFL 1.1 |
| Nunito Sans (variable + italic) | `nunito-sans-normal-latin.woff2`, `nunito-sans-italic-latin.woff2` | SIL OFL 1.1 |

License texts:

- SIL OFL 1.1: https://openfontlicense.org
- Fraunces: https://github.com/undercasetype/Fraunces (OFL.txt in repo)
- Nunito Sans: https://github.com/googlefonts/nunito-sans (OFL.txt in repo)

The full license text should be vendored alongside a distribution if the fonts are ever
redistributed outside this website. For the deployed site, the fonts are served as assets and
no redistribution obligation changes.

To refresh the fonts (only when intentionally changing typography):

```bash
node scripts/fetch-fonts.mjs
npm run verify
```
