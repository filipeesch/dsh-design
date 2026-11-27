# design-comments delta

## ADDED Requirements

### Requirement: Reproducible review coordinates
A submitted review comment SHALL include the effective theme and safe stable-ID coordinates sufficient to initialize its open overlays, active tabs, and Disclosure expansion over the authored starting state. Complete overlay selection SHALL distinguish an empty set from unavailable context; expansion coordinates SHALL distinguish false from omission. Captured values SHALL NOT include typed fields, secrets, or free-form input. Submission SHALL continue to send one deliberate batch and SHALL NOT create authored states or make pending drafts available to design tools.

#### Scenario: Comment after changing the interactive seed
- **WHEN** an owner switches a tab, closes an initially open disclosure, and submits a comment on a dark rendition
- **THEN** the submitted prompt identifies the tab, the explicit closed disclosure, and the theme without copying typed values or changing design files
