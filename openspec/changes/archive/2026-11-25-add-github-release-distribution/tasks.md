# Tasks

## 1. Prepare the distribution

- [x] 1.1 Document paste-to-install, pinned URLs, explicit upgrades, and the maintainer release steps. Verify Markdown formatting and that the documented paths match the package and asset names.
- [x] 1.2 Build and inspect the production tarball; stage it with the fixed asset name and a SHA-256 checksum. Verify the manifest, DSH patch, compiled files, and absence of deferred live capture in the tarball and source maps.
- [x] 1.3 Install the audited local tarball into a disposable DSH web profile and confirm the Design preset and synthetic local preview work before public publication.

## 2. Publish and verify

- [x] 2.1 Publish the versioned GitHub Release from the verified source commit already on the remote, with the audited tarball and checksum. Verify that both the public latest URL and the version-specific download return the audited bytes. Push the distribution documentation and archive after public installation verification.
- [x] 2.2 Install from the exact latest URL through the existing DSH UI in an isolated profile. Verify the installed package name and version, Design preset and synthetic local preview, without build-script approval; stop the temporary server.
