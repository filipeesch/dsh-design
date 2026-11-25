# Spec Delta

## ADDED Requirements

### Requirement: Implementation handoff guidance
Design guidance SHALL explain how to generate and regenerate a chosen handoff on demand, validate the design and relevant journeys, and share the manifest path with the implementing agent. It SHALL distinguish the design contract from generated implementation code and keep generated output out of Git.

#### Scenario: Share the accepted design with an implementer
- **WHEN** the owner requests a contract for an accepted design selection
- **THEN** the Design agent uses the handoff tool and provides the artifact paths and acceptance flows without generating application code
