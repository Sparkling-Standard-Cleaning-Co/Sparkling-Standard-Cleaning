# Encrypted off-site backups and recovery

**Status (2026-11-19): first real manual backup created, encrypted, uploaded and
restore-verified.** Cloudflare D1 and the local master workspace are covered.
Application R2 documents/photos and the scheduled GitHub workflow still require
owner-supplied R2 S3 credentials.

No password, API token, R2 key or encryption key is stored in this repository.

## 1. What is protected

A complete backup can include every category that matters to the business:

- D1 business database export (`--d1`).
- Private R2 document objects (downloaded with `backup:r2`).
- Private R2 customer photos (the same command with the photo bucket).
- The local company paperwork, legal masters, logos and financial records.
- Source videos and final video exports.

A D1 export does **not** contain R2 objects or local files. Each category must be
included explicitly.

## 2. How the archive works

- One streaming archive: `SSBA1` magic, AES-256-GCM, random 96-bit IV per
  archive, 128-bit authentication tag.
- Each file is framed with its path, size and a SHA-256 trailer. A single
  changed byte, a truncated archive or a wrong key fails closed.
- A JSON manifest records the archive SHA-256, every file hash, source
  inventories, the database export name and the restore command. The encrypted
  copy of the manifest is uploaded beside the archive.
- Encryption happens before upload. The backup bucket never receives plaintext.
- The archive output directory (`backup-out/`) and the R2 staging directory
  (`r2-archive/`) are git-ignored.

## 3. Commands

Inventory first:

```powershell
npm run backup:inventory -- "C:\Users\thoma\Documents\Sparkling-Standard-Master" "C:\Users\thoma\Downloads\SPARKLING STANDARD - MASTER"
```

Create a D1 export and a full local archive:

```powershell
npx wrangler@4 d1 export <database-name-or-id> --remote --output backup-out\d1.sql
$env:BACKUP_ENCRYPTION_KEY = '<base64 32-byte key from the password manager>'
npm run backup:create -- --d1 backup-out\d1.sql --source "master=C:\Users\thoma\Documents\Sparkling-Standard-Master" --source "videos=C:\path\to\source-videos" --out backup-out
```

Verify without touching production:

```powershell
npm run backup:verify -- backup-out\<archive>.ssbk
```

Restore into a new, empty directory:

```powershell
npm run backup:restore -- backup-out\<archive>.ssbk --out C:\Temp\sparkling-restore
```

Download every object from a private R2 bucket/prefix into a staging directory:

```powershell
$env:BACKUP_R2_ENDPOINT = 'https://<account-id>.r2.cloudflarestorage.com'
$env:BACKUP_R2_BUCKET = '<application-bucket>'
$env:BACKUP_R2_ACCESS_KEY_ID = '<scoped access key>'
$env:BACKUP_R2_SECRET_ACCESS_KEY = '<scoped secret>'
npm run backup:r2 -- --out r2-archive\documents --prefix documents/
```

Upload the archive and manifest to the separate backup bucket:

```powershell
npm run backup:create -- --d1 backup-out\d1.sql --source "master=C:\..." --out backup-out --upload
```

`--upload` needs `BACKUP_R2_ENDPOINT`, `BACKUP_R2_BUCKET`,
`BACKUP_R2_ACCESS_KEY_ID`, `BACKUP_R2_SECRET_ACCESS_KEY`. The bucket must be
private and separate from the application photo/document buckets.

## 4. Activation checklist (owner actions)

The code and the scheduled workflow exist, but the following must be done by the
owner before backups are operational:

1. Create a **private** R2 bucket named for backups, separate from the
   application buckets.
2. Create a dedicated R2 S3 API token limited to that backup bucket. Do not reuse
   the application tokens.
3. Generate a 32-byte encryption key locally (`openssl rand -base64 32` or
   equivalent) and store it in the owner password manager. Losing this key makes
   every archive unrecoverable. Never email it or commit it.
4. Add repository secrets:
   `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_NAME`,
   `BACKUP_ENCRYPTION_KEY`, `BACKUP_R2_ENDPOINT`, `BACKUP_R2_BUCKET`,
   `BACKUP_R2_ACCESS_KEY_ID`, `BACKUP_R2_SECRET_ACCESS_KEY`.
5. Enable the `.github/workflows/backup.yml` schedule (it is dormant until the
   secrets exist).
6. Choose and document a **secondary independent destination** outside the
   Cloudflare account (for example an encrypted external drive kept off-site, or
   another provider's private object storage). Cloudflare R2 alone is not an
   independent recovery destination.
7. Run one manual workflow dispatch and one full local archive, then run
   `backup:verify` on both.
8. Record the first successful restore rehearsal date in this document.

Until those steps are complete, backups are **not** operational.

## 5. Recommended schedule

| Source | Frequency | Retention |
| --- | --- | --- |
| D1 export | Daily automatic (workflow) | 30 daily, 12 monthly |
| Application R2 objects | Weekly local sync + archive | 12 weeks |
| Local master paperwork and logos | Weekly incremental archive | 12 weeks |
| Source videos and exports | Monthly archive | 6 months |
| Full verification and restore rehearsal | Monthly | Keep the report |

Adjust only after checking storage cost. R2 has no egress fee; storage is billed
by GB-month. No paid service is activated without owner approval.

## 6. Restore procedure

1. Obtain the archive and its manifest from the private backup bucket.
2. Verify the archive SHA-256 against the manifest.
3. Run `npm run backup:verify -- <archive>`; it must report `ok: true` and
   `integrity: ok` for every database.
4. Restore into a new empty directory with `backup:restore`.
5. Inspect records, open selected documents and videos, and compare counts.
6. For D1 recovery, follow the approved Cloudflare recovery procedure. Never
   import an unverified archive over production and never restore directly into
   the live database.
7. For R2 recovery, upload only the verified objects to the intended bucket and
   confirm the application can read them.
8. Record what was restored, when, by whom, and what was intentionally excluded.

## 7. Verification evidence

`tests/backup.test.ts` proves:

- encrypted round-trip of text, JSON, binary and SQL files;
- plaintext is absent from the archive;
- one changed byte, a truncated archive or a wrong key fails closed;
- the manifest decrypts and carries the archive digest;
- `verify` reports a healthy D1 SQL export with a real SQLite integrity check;
- restore refuses a non-empty destination and restores into an isolated one;
- R2 requests are SigV4-signed and object listings paginate.

Actual production backup and restore were **not** performed because the
credentials and destination do not exist yet.

## 8. First real backup - 2026-11-19

### Cloudflare D1

- Export: `d1-pre-0038-0039-2026-11-19.sql` from `sparkling-standard-operations`.
- Encrypted archive: `sparkling-standard-backup-2026-11-20T01-09-34.ssbk`.
- Archive size: 218,628 bytes; SHA-256 `268ef6287034ca063611c7728501b8e11dd92212b9b88358188727bffadad37e`.
- Verified locally and after a remote download: 1 file, 78 tables, SQLite
  `integrity_check = ok`.
- Remote location: `sparkling-standard-backups/sparkling-standard/backups/d1/`
  (archive, encrypted manifest, checksum).

### Local master workspace

- Source: `C:\Users\thoma\Downloads\SPARKLING STANDARD - MASTER` (excluding its
  own `08 BACKUPS & ARCHIVE` folder).
- Encrypted archive: `sparkling-standard-backup-2026-11-20T01-36-53.ssbk`.
- Files: 1,681; plaintext 2,498,139,542 bytes; archive 2,498,421,718 bytes.
- SHA-256 `e1e4ddcbafcfc2a89989ba226cdd0b13ce2ad22d5363a5a2baad4619db0ec75d`.
- Local verify: all 1,681 files and sizes passed.
- Restore rehearsal to an isolated temporary directory passed; a PDF opened with
  `%PDF-` header and a video with `ftypmp42`.
- Remote storage: the 2.5 GB archive was split into 10 authenticated-encrypted
  parts (250 MB each) under
  `sparkling-standard-backups/sparkling-standard/backups/master/parts/`, plus the
  parts manifest. The parts were downloaded again, rejoined, and the rejoined
  archive matched the original SHA-256 and passed full verification.
- Local archive, manifest, checksum and parts remain in
  `08 BACKUPS & ARCHIVE\MASTER\2026-11-19\`.

### Key custody

The 32-byte key is stored as a Windows DPAPI-protected value at
`08 BACKUPS & ARCHIVE\keys\d1-backup-key-dpapi.txt`. It is readable only by the
owner's Windows account on this machine. Copy it into the owner password manager
and store the recovery copy off-site; a machine loss without that copy makes the
archives unrecoverable.

### Still uncovered

- Application R2 buckets `sparkling-standard-documents` and
  `sparkling-standard-lead-photos`: the S3 API requires a dedicated R2 access key
  and secret. Wrangler OAuth can write objects but cannot list/download every
  object for archive creation. The owner must create a bucket-scoped R2 S3 token.
- Scheduled GitHub workflow: needs the GitHub secrets plus the R2 S3 token.
- A truly independent secondary destination outside the Cloudflare account: the
  owner must choose and provision it.
