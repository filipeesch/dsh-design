# Releasing dsh-design

The **Stable plugin release** workflow ([release.yml](../.github/workflows/release.yml))
publishes the prebuilt bundle and its SHA-256 checksum as GitHub Release assets.
Users install from the stable download URL in the [install guide](../README.md#install).

## Before merging

[Pull request CI](../.github/workflows/pr-check.yml) runs `pnpm run check` on
GitHub's proposed merge commit for PRs targeting `main`. It uses a read-only
token and does not create tags or releases. Wait for **PR build and tests**
to pass before merging. To enforce this, configure it as a required status
check for `main` and require PR branches to be up to date before merge.
The release workflow still checks the exact merged commit separately.

## What triggers a release

- The workflow listens for `pull_request_target` events of type `closed` and
  publishes only for PRs merged into `main`. An unmerged closure or a direct
  push does not publish. It builds the PR's exact merge SHA, not the PR head
  or whatever happens to be at the tip of `main` when the job starts.
- One release job runs at a time using `queue: max`; new merges queue rather
  than canceling the active job. The next version is a patch bump from the
  highest stable version among existing tags and release records (including
  drafts), and the bundle manifest at the merge SHA. No version-bump
  commit or generated files are needed.
- A matching draft for the same source SHA resumes at its existing version.
  The workflow checks existing assets before reusing them and never overwrites
  an asset or moves a tag. The published files are `dsh-design-bundle.tgz`
  and `dsh-design-bundle.tgz.sha256`.
- The job promotes a release to **Latest** only if it advances both the
  source history and the version of the current Latest release. A delayed
  run for older source still publishes under its own tag-specific URL.

## Verify locally without publishing

From the repository root with Node.js 24.9 or newer and pnpm 11:

```sh
actionlint .github/workflows/release.yml
pnpm install --frozen-lockfile --ignore-scripts
node scripts/release-bundle.mjs pack 0.1.2
```

If your `actionlint` does not recognize GitHub’s documented `queue: max`,
rerun with `-ignore 'unexpected key "queue" for "concurrency" section'` and
check the queue setting against the [workflow syntax reference](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#concurrency).
The example version is for local testing, not a reservation. The pack command
runs `pnpm run check`, uses the existing pack script to write into `dist/`, and restores
`packages/bundle/package.json` after the temporary version change. It does
not create a tag or publish anything.

Inspect the tarball in `dist/` with `tar -tzf` and use `tar -xOzf` to inspect
`package/package.json` and `package/cordis.patch.yml`. Confirm the manifest
names `@filipeesch/dsh-design-bundle`, reports the requested version, declares
the DSH bundle patch, and has no install-time build scripts. Check for the
compiled host, preset, tools, client, renderer, and font files. Audit archive
paths, code, configuration, and source maps for unexpected content, private
data, or deferred live capture tooling or workers.

Follow the [disposable DSH profile procedure](verification.md#packed-install-in-a-disposable-real-dsh)
to install the local tarball on a separate loopback port. Confirm that the
Design preset opens an authenticated preview using the synthetic example, then
stop the server. Do not use a real profile or workspace.

## Check the Design upgrade

In the disposable profile, use the [release console](../examples/release-console)
to check that the installed bundle renders shared layouts, palettes, and
classes. Call `design_status` in a Design session and record the **running**
build separately from the kit pin and installed kit version; check that the
preview and reported theme and journey selections are usable. Confirm the ten
Design tools are registered in Design, none in Standard, and that the compact
Design guidance is absent from Standard.

Run the example's journey and inspect desktop/light, mobile/dark, and the
mobile anchored **Release options** popover. Keep the source revision, actual
build selection, and accessible evidence paths with the verification notes.
PNG capture is explicit: check path delivery and inline delivery where
supported. A clean validation result alone does not verify visual appearance.

**Breaking change:** `design_handoff` is no longer registered. Release notes
should direct consumers to [share existing paths](authoring.md#share-accepted-design-files)
and the accepted screen, state, breakpoint, theme, variant, and source revision
when applicable. Existing exports are not changed or deleted. Existing projects
need no automatic pin or source migration. To roll back a project that has
adopted the new syntax, use the prior plugin with a source revision from before
the opt-in if that plugin cannot read the new files.

## Verify the first automated release

After the first eligible merge, open **Actions → Stable plugin release** and
find the run for that PR. Check that its build used the PR's full merge SHA
and note the published tag. Verify that the remote tag resolves to the same
commit (use the peeled SHA for an annotated tag), the release is neither a
draft nor a prerelease, and its **Latest** status agrees with the source and
version ordering described above. Confirm exactly two uploaded assets with the
expected names.

Set `TAG` to the published tag. Download the files without credentials and
verify the checksum:

```sh
REPO=filipeesch/dsh-design
ASSET=dsh-design-bundle.tgz
PUBLIC=$(mktemp -d)
git ls-remote --exit-code origin "refs/tags/$TAG" "refs/tags/$TAG^{}"
for file in "$ASSET" "$ASSET.sha256"; do
  curl -qfsSL "https://github.com/$REPO/releases/download/$TAG/$file" -o "$PUBLIC/$file" || exit 1
done
(cd "$PUBLIC" && shasum -a 256 -c "$ASSET.sha256")
```

If the release is **Latest**, also download both files via
`releases/latest/download/` and confirm they match the tag-specific downloads
byte for byte. Inspect the published manifest and confirm its version matches
the tag (without the leading `v`).

In a fresh disposable DSH web profile, paste the exact latest asset URL into
**Plugins → Add plugin** (or use the tag-specific URL to test a non-latest
release). Wait for installation to finish, select **Enable now** if offered,
then restart if required. Confirm the installed name and version, the Design
preset, and the authenticated synthetic preview. Verify that the first Design
turn completes using synthetic input and that DSH preserves the literal DSX
examples in its prompt. No build-script approval is required. Stop the server
after the check.

## Rerun or diagnose a failed release

For a transient failure, open the original workflow run for the merged PR and
choose **Re-run all jobs**. This keeps the original merge SHA; a new PR or push
is not a retry. If the run left a draft for that SHA, it resumes the same draft,
reuses matching assets, and uploads only missing files.

If the logs report a conflicting draft or asset, record the original merge SHA
and the draft tag. In GitHub Releases, inspect the draft's target and uploaded
assets; compare the target and any existing remote tag with the original SHA.
Compare the uploaded names, sizes, and SHA-256 digests with the expected
assets from that run. A draft for another source, multiple drafts for the same
source, a tag pointing elsewhere, or a mismatched asset is not safe to resume
blindly. Leave the release unpublished while a maintainer investigates. Do not
retarget tags, publish a conflicting draft, or overwrite assets to force a
rerun through.

If verification fails, do not advertise the new release as ready. If there is a
previous known-good release, restore its latest marker. If the published bytes
need correction, publish a new version rather than overwriting the old asset.
