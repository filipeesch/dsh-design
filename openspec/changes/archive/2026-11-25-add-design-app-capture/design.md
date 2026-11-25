# Design

## Decision

Close this change as deferred, not as an implementation of live app capture. Preserve the prototype locally, but exclude its tool registration, prompt guidance, configuration, worker, and service files from the production bundle. Keep the existing preview and handoff behavior unchanged.

## Verification

Check tool and prompt registration in the host tests, preserve the preset composition contract, and inspect the production tarball, including source maps. Verify preview and handoff without a live capture runtime. These checks verify the narrower production scope; they do not establish live capture support.

## Future release gate

A separate change must pass independent end-to-end acceptance of the exact installed package on an owner-approved runtime before including or exposing live capture. The review must verify both an OS-enforced browser network boundary and the enabled Chromium sandbox. It must also verify owner-authorized navigation, Desktop and Mobile evidence, redaction, and cancellation cleanup. Chromium flags or request interception alone are not an operating-system boundary.
