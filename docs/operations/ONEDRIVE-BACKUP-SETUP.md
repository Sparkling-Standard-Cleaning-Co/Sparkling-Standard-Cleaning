# OneDrive encrypted backup destination

Updated: 2026-11-21

## Why the app folder

Microsoft Graph supports a delegated `Files.ReadWrite.AppFolder` permission
only for personal Microsoft accounts. It grants this backup application access
to its own OneDrive app folder and nothing else in the owner's personal drive.

The application folder is:

```text
OneDrive / Apps / Sparkling Standard / Sparkling-Standard-Encrypted-Backups
```

The root-level folder named `Sparkling-Standard-Encrypted-Backups` is not used
because granting access to it would require the much broader `Files.ReadWrite`
scope over the entire personal OneDrive. The app-folder design is the minimum
permission that supports unattended encrypted backup uploads.

## Owner step 1 - register the public client

This is the one required Microsoft setup step. Do not paste any secret into chat.

1. Open <https://entra.microsoft.com>.
2. Select **Identity → Applications → App registrations → New registration**.
3. Name it `Sparkling Standard Backup`.
4. Supported account types: **Accounts in any organizational directory and
   personal Microsoft accounts** (or the personal-account-only option offered by
   your tenant).
5. Leave the redirect URI empty.
6. Select **Register**.
7. Open **Authentication → Advanced settings** and set
   **Allow public client flows** to **Yes**, then **Save**.
8. Copy the **Application (client) ID** from the Overview page. This is not a
   password or client secret.

The script uses delegated device-code authorization with:

```text
offline_access Files.ReadWrite.AppFolder User.Read
```

No client secret is created or stored. Device-code flow is a public-client flow
and is supported by Microsoft personal accounts through the `consumers` tenant.

## Owner step 2 - authorize the account

On the owner Windows computer, run:

```powershell
$env:ONEDRIVE_CLIENT_ID = '<application-client-id>'
npm run backup:onedrive -- auth
```

Open the displayed Microsoft device-login URL, enter the one-time code, and
approve the app-folder permission. The refresh token is stored with Windows
DPAPI at:

```text
%USERPROFILE%\.config\sparkling-standard\onedrive-token.dpapi
```

The token is never printed or committed. To use the same authorization in
GitHub Actions, add the refresh token as the repository secret
`ONEDRIVE_REFRESH_TOKEN`. The token must be copied from a secure source; never
place it in chat, a file in the repository, or a workflow log.

If Microsoft rotates the refresh token, the local DPAPI cache is updated. GitHub
Actions cannot update its own secret; if automatic refresh stops working, rerun
the owner auth command and replace the `ONEDRIVE_REFRESH_TOKEN` secret.

## GitHub repository secrets

Add after the owner authorization:

| Secret | Purpose |
| --- | --- |
| `ONEDRIVE_CLIENT_ID` | Public application/client ID |
| `ONEDRIVE_REFRESH_TOKEN` | Delegated refresh token from the owner auth flow |
| `ONEDRIVE_FOLDER` | Optional; defaults to `Sparkling-Standard-Encrypted-Backups` |
| `ONEDRIVE_CAPACITY_BYTES` | Optional; defaults to 5 GiB |

Existing backup secrets remain required for R2 and D1. Never create a client
secret for this public client.

## Commands

```powershell
npm run backup:onedrive -- quota
npm run backup:onedrive -- list
npm run backup:onedrive -- upload --archive backup-out\<archive>.ssbk
npm run backup:onedrive -- download --name <remote-name> --out C:\Temp\<name>
npm run backup:retention -- --daily 30 --weekly 12 --monthly 12
```

Retention is dry-run unless `--apply` is supplied. The newest bundle,
pre-migration bundles and explicit `--legal-hold` IDs are always retained.
Capacity warnings return exit code 2; they do not silently delete the only
known-good recovery point.

## Verification

After upload, download the archive from OneDrive and verify it independently:

```powershell
$env:BACKUP_ENCRYPTION_KEY = '<owner recovery key from the password manager>'
npm run backup:verify -- <downloaded-archive>
npm run backup:restore -- <downloaded-archive> --out C:\Temp\isolated-restore
```

A provider upload response is not restore proof. The owner must retain the
recovery key outside OneDrive and outside the primary Windows computer.
