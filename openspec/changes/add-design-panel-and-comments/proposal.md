# Proposal

## Why

Reviewing a design means looking at it next to the conversation and pointing at specific components. Today the preview lives in a separate tab and feedback has to be described in words, which loses which component, state, and breakpoint the user meant.

## What Changes

- A DSH GUI panel, contributed by the plugin's client package, that shows the current session's preview beside the chat.
- A comment mode in the preview: the user pins balloons on any rendered component; each comment records the node ID (or flags an unstable structural address), screen, interaction state, breakpoint, and variant when variants exist.
- Pending comments are kept by the host per session, outside the repository, and survive page reloads.
- A "send to agent" action delivers all pending comments to the session as one message with their structured context; after sending, the balloons disappear. Comments are never written to the repository.
- Preset guidance for handling a comment batch: locate each node, apply changes, and reply per comment in the chat.

## Capabilities

### New Capabilities

- `design-panel`: the GUI panel, its placement, and how it follows the active session.
- `design-comments`: pinning, the context captured per comment, pending storage, batch delivery, and clearing after delivery.

### Modified Capabilities

- `design-preview-server`: comment mode and the endpoints that store and send comments.
- `design-agent-preset`: guidance for comment batches.

## Impact

- Depends on the foundation spike result for external client plugins (task 2.6 of `add-design-foundation`); if that failed, this change is re-planned around the separate preview tab.
- Delivering a message into a session from a plugin route needs the session's follow-up API; to be confirmed when this change is planned.
