# Spec Delta

## ADDED Requirements

### Requirement: Address review comments in the conversation
The preset SHALL teach the design agent to locate each submitted comment using its screen, breakpoint, interaction context, and node identity; apply the requested changes to the design text; and reply in chat with what changed or what could not be located. It SHALL explain that structural addresses may be stale. It SHALL NOT imply that comment drafts are versioned or available to a tool before submission.

#### Scenario: A batch contains a stale address
- **WHEN** the agent receives a batch containing a comment with an unresolved structural address
- **THEN** the guidance tells it to use the available context or ask for clarification, not silently apply the comment to a different component
