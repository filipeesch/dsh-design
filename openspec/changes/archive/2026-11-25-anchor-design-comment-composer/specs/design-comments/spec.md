# Spec Delta

## ADDED Requirements

### Requirement: Component-anchored comment composer
When the owner selects a component in comment mode from a desktop browser, the interactive preview SHALL open a comment balloon beside that component, not at a fixed footer location. The balloon SHALL visibly point to its target, fit within the visible preview pane, and stay aligned when the target moves or the pane scrolls or resizes. Placement SHALL NOT change the design canvas geometry. This interaction SHALL work at the Mobile preview breakpoint on a desktop browser as well as at desktop breakpoints.

#### Scenario: Comment next to a component in a Mobile preview on a PC
- **WHEN** the owner uses a desktop browser, selects the Mobile breakpoint, and clicks a visible control inside an open drawer in comment mode
- **THEN** a focused comment balloon appears next to that control without activating it or closing the drawer

#### Scenario: Place a balloon near a pane edge
- **WHEN** the target is near the edge of the preview pane or the pane is resized or scrolled
- **THEN** the balloon chooses an available side or shifts within the pane and continues to point to the same component while it is visible

### Requirement: Reopen comments at their anchors
Saving a comment SHALL close the balloon and leave its pin. Activating a pin by pointer or keyboard SHALL reopen the editor at the same component. Closing or saving SHALL restore focus to an appropriate origin without triggering the target control. If the component cannot be safely resolved, the preview SHALL NOT show a balloon pointing to a different element. A saved comment with an unavailable anchor SHALL remain editable from Pending. Pending review and deliberate batch submission SHALL retain their existing behavior.

#### Scenario: Save and reopen a comment
- **WHEN** the owner saves a new comment and then activates the remaining pin
- **THEN** the saved text is editable in a balloon at the original component, and Escape closes the balloon without activating underlying controls

#### Scenario: An anchor is no longer available
- **WHEN** a saved draft belongs to another screen or variant, or its component was removed
- **THEN** the owner can still edit it in Pending without a balloon attached to an unrelated component
