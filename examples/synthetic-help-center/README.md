# Bike library help center example

A single-screen, fictitious help center. Open a **Design** session in this
folder or copy its `design/` into a fresh workspace, then open the preview URL
from `design_status`.

The pickup answer starts open. Open the borrowing answer, then close the pickup
answer; the borrowing answer stays open and the page does not navigate. Try
focusing each question with Tab, then pressing Enter or Space. The map has one
screen and no links: a local disclosure does not imply navigation.

Run `design_run_journey({ journey: "help-faq" })` to check the same behavior in
Chromium. See the
[authoring guide](../../docs/authoring.md#set-up-chromium-for-measured-checks)
for browser setup.
