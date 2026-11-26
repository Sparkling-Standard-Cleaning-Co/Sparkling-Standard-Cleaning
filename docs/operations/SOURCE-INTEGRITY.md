# Source integrity and encoding safety

## Observed failure

During the 2026-11-26 booking investigation, source files were read with
Windows PowerShell 5.1 `Get-Content -Raw` (system ANSI code page) and rewritten
with `Set-Content -Encoding UTF8`. This produced mojibake, replacement
characters and mid-file BOMs in several `.astro`, `.ts` and test files.

## Root-cause correction

- Every affected source file was repaired and re-verified as valid UTF-8.
- Source edits now use the editor tooling or Node `fs.readFileSync(..., 'utf8')`
  plus `fs.writeFileSync(..., 'utf8')`, never PowerShell `Get-Content` /
  `Set-Content` for source.
- `.editorconfig` declares UTF-8 and LF for the repository.
- `.gitattributes` continues to normalize text to LF.
- `scripts/check-source-integrity.mjs` runs in every build preflight and rejects:
  invalid UTF-8, mid-file BOMs, Git conflict markers, control characters,
  malformed JSON and runtime mojibake.
- `npm run integrity` exposes the same check for local/CI use.

## Mandatory check

```text
npm run integrity
```

The build fails before Astro runs if the source is corrupted.

## Safe edit examples

```text
node -e "const fs=require('fs');const p='src/example.ts';let s=fs.readFileSync(p,'utf8');s=s.replace('old','new');fs.writeFileSync(p,s,'utf8');"
```

PowerShell users must use `-Encoding UTF8` for any diagnostic read and must not
write source through `Set-Content`. The preferred path is the repository editor
tool, which preserves UTF-8 and LF.
