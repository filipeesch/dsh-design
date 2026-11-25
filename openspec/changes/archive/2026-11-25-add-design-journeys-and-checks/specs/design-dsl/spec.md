# Spec Delta

## MODIFIED Requirements

### Requirement: JSX-style syntax without JavaScript
A screen file SHALL contain exactly one `Screen` root element written in JSX syntax. Prop values SHALL be limited to string literals, and inside braces to number, boolean, and `null` literals, arrays of literals, object literals of literals, token references, and the explicitly declared interaction and fixture references. A screen may declare named state metadata and collection templates using the documented DSL schema. Journey files SHALL use the same restricted JSX grammar and a distinct `Journey` root with typed step elements. Any other construct (imports, statements, identifiers other than allowed references, operators, template literals, arbitrary function calls, spread) MUST be rejected with a diagnostic and MUST NOT be executed.

#### Scenario: Valid screen
- **WHEN** a file contains `<Screen id="orders" title="Orders"><Text>Hello</Text></Screen>`
- **THEN** validation reports no errors and the screen renders

#### Scenario: JavaScript rejected
- **WHEN** a prop contains `{items.map(x => x)}` or a file contains an `import`
- **THEN** validation reports an error at that location stating that expressions are not allowed, and nothing in the file is evaluated

#### Scenario: Separate journey grammar
- **WHEN** a journey contains a supported assertion element with typed literal props
- **THEN** it is parsed as a journey step and is not treated as a renderable kit component
