# Releasing dsh-design

Publish the prebuilt bundle and its checksum as GitHub Release assets. No
GitHub Actions workflow or generated files in Git are required. Users can
paste the stable download URL from the [install guide](../README.md#install).

## 1. Build from an exact, pushed source commit

Use a clean checkout of the source commit, Node.js 24.9 or newer, and pnpm 11.
Set `SOURCE_SHA` to the full commit SHA, and confirm it is on the remote's main
branch. Use a fresh version; never move an existing release tag or replace a
published asset.

```sh
REPO=filipeesch/dsh-design
git fetch origin main
git merge-base --is-ancestor "$SOURCE_SHA" FETCH_HEAD
test "$(git rev-parse HEAD)" = "$SOURCE_SHA"
test -z "$(git status --porcelain)"
VERSION=$(node -p "require('./packages/bundle/package.json').version")
TAG="v$VERSION"
pnpm install --frozen-lockfile
pnpm run check

STAGE=$(mktemp -d)
ASSET=dsh-design-bundle.tgz
pnpm --dir packages/bundle pack --pack-destination "$STAGE"
mv "$STAGE/filipeesch-dsh-design-bundle-$VERSION.tgz" "$STAGE/$ASSET"
(cd "$STAGE" && shasum -a 256 "$ASSET" > "$ASSET.sha256")
```

## 2. Audit and smoke-test the staged bundle

```sh
tar -tzf "$STAGE/$ASSET"
tar -xOzf "$STAGE/$ASSET" package/package.json
tar -xOzf "$STAGE/$ASSET" package/cordis.patch.yml
(cd "$STAGE" && shasum -a 256 -c "$ASSET.sha256")
```

Confirm the manifest names `@filipeesch/dsh-design-bundle` and matches the tag
version. It must declare the DSH bundle patch and have no install-time build
scripts. Check for the compiled host, preset, tools, client, renderer, and font
files. Check archive paths, code, configuration, and source maps for unexpected
content, private data, and any deferred live capture tooling or worker.

Follow the [disposable DSH profile procedure](verification.md#packed-install-in-a-disposable-real-dsh)
to install the staged file on a separate loopback port. Confirm the Design
preset opens an authenticated preview for the synthetic example, then stop the
server. Do not use a real profile or workspace.

## 3. Upload, check, and publish

Use an authenticated maintainer account. Write release notes in a separate
`$STAGE/notes.md` file that includes the stable install URL. Keep the asset and
checksum names unchanged across releases; do not upload logs or build folders.

```sh
gh release create "$TAG" "$STAGE/$ASSET" "$STAGE/$ASSET.sha256" \
  --repo "$REPO" --target "$SOURCE_SHA" --draft \
  --title "DSH Design $TAG" --notes-file "$STAGE/notes.md"
gh release view "$TAG" --repo "$REPO" \
  --json isDraft,isPrerelease,targetCommitish,assets \
  --jq '{isDraft,isPrerelease,targetCommitish,assets:[.assets[] | {name,size,state,digest}]}'
shasum -a 256 "$STAGE/$ASSET" "$STAGE/$ASSET.sha256"
```

Confirm the release is a draft, not a prerelease, and points to `SOURCE_SHA`.
Check that exactly the expected two files are uploaded and both GitHub digests
match the staged files before promoting it.

```sh
gh release edit "$TAG" --repo "$REPO" --draft=false --latest
git ls-remote --exit-code origin "refs/tags/$TAG"
gh release list --repo "$REPO" --json tagName,isLatest,isDraft,isPrerelease
```

Confirm the new remote tag points to the audited commit and the release is
marked latest. Check both public routes without credentials:

```sh
PUBLIC=$(mktemp -d)
for route in latest/download "download/$TAG"; do
  for file in "$ASSET" "$ASSET.sha256"; do
    curl -qfsSL "https://github.com/$REPO/releases/$route/$file" -o "$PUBLIC/$file"
    cmp "$STAGE/$file" "$PUBLIC/$file"
  done
  (cd "$PUBLIC" && shasum -a 256 -c "$ASSET.sha256")
done
```

In a fresh disposable DSH web profile, paste the exact latest asset URL into
**Plugins → Add plugin**. Wait for installation to finish, select **Enable now**
if offered, then restart if required. Confirm the installed name and version, the Design preset,
and the synthetic preview. Verify that the first Design turn completes using a
synthetic input and that DSH preserves the literal DSX examples in its prompt.
No build-script approval is required. Stop the server after the check.

If verification fails, do not advertise the new release as ready. If there is a
previous known-good release, restore its latest marker. If the published bytes
need correction, publish a new version rather than overwriting the old asset.
