# Publishing Json Explorer (Open VSX)

This extension is published to **Open VSX** (https://open-vsx.org), the open
registry used by VSCodium, Cursor, Gitpod, Eclipse Theia, and others.

`package.json` → `publisher` is set to **`00index`**, which is also the Open VSX
**namespace** you'll create below. (Change it if you want a different namespace.)

## 1. Get an Open VSX account + token

1. Sign in at https://open-vsx.org with your GitHub account.
2. Sign the **Eclipse Publisher Agreement** (one-time): create/log in to an
   Eclipse Foundation account when prompted and accept the agreement. Publishing
   is rejected until this is signed.
3. Create an **Access Token**: avatar → *Settings* → *Access Tokens* → generate
   one and copy it (shown once).

## 2. Create your namespace (one-time)

The namespace must equal `package.json` → `publisher` (`00index`):

```sh
npx ovsx create-namespace 00index -p <OVSX_TOKEN>
```

## 3. Publish manually (first time)

```sh
npm run compile
npm run package                                  # builds json-explorer.vsix
npx ovsx publish json-explorer.vsix -p <OVSX_TOKEN>
```

Verify at: https://open-vsx.org/extension/00index/json-explorer

## 4. Publish via GitHub Actions (later releases)

Add one repository secret (Settings → Secrets and variables → Actions):

- `OVSX_PAT` – the Open VSX token from step 1.

Then cut a release by pushing a tag:

```sh
# bump "version" in package.json first, e.g. 0.1.1
git commit -am "Release 0.1.1"
git tag v0.1.1
git push origin main --tags
```

`.github/workflows/release.yml` packages, publishes to Open VSX, and attaches
the `.vsix` to a GitHub release.

## Installing the result

- In VSCodium / Cursor: search "Json Explorer" in the Extensions view (Open VSX
  is their default registry).
- In regular VS Code (which uses the MS Marketplace, not Open VSX): download the
  `.vsix` from the GitHub release and run **Extensions: Install from VSIX…**.

## Notes

- **jq** must be installed on the user's machine (on `PATH`, or set
  `jsonExplorer.jqPath`). The README documents this and the extension shows a
  friendly error if jq is missing.
- Bump `package.json` → `version` for every publish; the registry rejects
  re-publishing the same version.
- Not publishing to the VS Code Marketplace (that needs an Azure DevOps PAT). If
  you ever want to, run `npx @vscode/vsce publish` after `vsce login`.
