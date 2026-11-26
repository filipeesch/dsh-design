# Document outcomes example

A fictitious editorial review for the Harbor Archive. No document is uploaded,
no service runs, and no application data is written.

Open a **Design** session in this directory or copy its `design/` folder into
a fresh workspace. Open the URL from `design_status`.

1. On **Document review**, click **Submit for review**. This is a prototype
   navigation action to **Review status**, which starts in **Waiting**. The
   **Awaiting review** situation is a shortcut to the same starting point.
2. Open the map and read the **Prototype**, **Simulated**, and **Illustrative**
   relationships. Closing the map leaves the waiting screen in place.
3. Choose **Correction request** under **Simulated outcomes**, outside the
   canvas. The **Correction requested** situation opens with **Corrections**
   selected and **Editorial note** expanded. Collapse the note in place.
4. Go back and choose **Approval** to open the separate **Document approved**
   starting view. The outcome choices do not run automatically or appear on
   the target's named state.

The manual choices are declared in [preview.json](design/preview.json). The
Chromium journeys `document-submit`, `document-approved`, and
`document-correction` verify the actual navigation and the canvas at each named
outcome. Journeys do not operate preview chrome. See the
[authoring guide](../../docs/authoring.md#set-up-chromium-for-measured-checks)
for browser setup.
