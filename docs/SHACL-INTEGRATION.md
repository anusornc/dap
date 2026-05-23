# SHACL Integration Guide

SHACL-like validation for DAP agent registration, messages, and jobs using TTL shape definitions.

## Overview

The DAP project uses a TypeScript-based SHACL-like validator (`src/validation/shacl-validator.ts`) that parses Turtle (TTL) shape files to extract field constraints, then validates JSON data against those constraints. This provides declarative, human-readable validation rules separate from code.

## What the Validator Does

The `SHACLValidator` class:

1. **Loads TTL shape files** at startup from the `shapes/` directory
2. **Parses SHACL 1.1 predicates** to extract field constraints:
   - `sh:path` — field name
   - `sh:minCount` / `sh:maxCount` — cardinality
   - `sh:datatype` — type check (string, integer, boolean, datetime, URI)
   - `sh:pattern` — regex validation
   - `sh:minLength` / `sh:minInclusive` / `sh:maxInclusive` — value constraints
   - `sh:in` — allowed values enumeration
3. **Validates JSON data** against loaded shapes
4. **Returns structured errors** with path, message, and severity

```typescript
import { SHACLValidator } from './src/validation/shacl-validator.js';

const validator = new SHACLValidator('./shapes');
const result = validator.validateAgent(agentData);

if (!result.valid) {
  console.error('Validation failed:', result.errors);
}
```

## TTL Shape Files

Shape files are stored in `shapes/` and define validation rules for each entity type:

| File | Shape Name | Validates |
|------|-----------|-----------|
| `shapes/agent-shape.ttl` | `dap:AgentRegistrationShape` | Agent registration records |
| `shapes/message-shape.ttl` | `dap:MessageShape` | DAP protocol messages |
| `shapes/job-shape.ttl` | `dap:JobShape` | Job queue records |

### Example: agent-shape.ttl

```turtle
@prefix sh:   <http://www.w3.org/ns/shacl#> .
@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .
@prefix dap:  <https://dap-protocol.org/ns#> .

dap:AgentRegistrationShape a sh:NodeShape ;
  # Required field: agent_id (alphanumeric, underscore, hyphen)
  sh:property [
    sh:path dap:agent_id ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:pattern "^[a-zA-Z0-9_-]+$" ;
  ] ;
  # Required array: capabilities (at least 1 item)
  sh:property [
    sh:path dap:capabilities ;
    sh:minCount 1 ;
    sh:eachItemShape [
      sh:datatype xsd:string ;
    ] ;
  ] ;
  # Optional: version (semver pattern)
  sh:property [
    sh:path dap:version ;
    sh:pattern "^\\d+\\.\\d+\\.\\d+" ;
  ] .
```

## Integration Points

### AgentRegistry Integration

In `src/relay/agent-registry.ts`, the validator is initialized and used during agent registration:

```typescript
export class AgentRegistry {
  private shaclValidator: SHACLValidator | null = null;

  constructor(shapesDir?: string, options?: { testMode?: boolean }) {
    try {
      this.shaclValidator = new SHACLValidator(shapesDir || './shapes');
    } catch (err) {
      console.warn('[AgentRegistry] SHACL validator init failed:', err);
    }
    if (options?.testMode) {
      this.shaclValidator = null;  // Disable validation in tests
    }
  }

  register(agentId: string, agentInfo: AgentInfo, socket: any, capabilities: Capability[] = []) {
    // Validate against agent-shape.ttl before registration
    if (this.shaclValidator?.hasShapes()) {
      const result = this.shaclValidator.validateAgent(agentInfo);
      if (!result.valid) {
        return { valid: false, error: { message: 'Agent registration validation failed', errors: result.errors } };
      }
    }
    // ... proceed with registration
  }
}
```

### JobQueue Integration

The JobQueue can be extended to validate jobs at submission. Currently, job validation is available via the validator directly:

```typescript
import { getValidator } from './src/validation/shacl-validator.js';

const validator = getValidator('./shapes');

// Validate a job before submitting
const result = validator.validateJob({
  job_id: '550e8400-e29b-41d4-a716-446655440000',
  type: 'code-generation',
  priority: 5,
  submitter: 'agent-001',
  status: 'pending',
  payload: {},
});

if (!result.valid) {
  throw new Error(`Invalid job: ${result.errors.map(e => e.message).join(', ')}`);
}
```

## Field Constraints Reference

### Required Fields

Use `sh:minCount 1` to mark a field as required:

```turtle
sh:property [
  sh:path dap:job_id ;
  sh:minCount 1 ;
  sh:message "job_id is required" ;
].
```

### Datatypes

```turtle
# String (default)
sh:datatype xsd:string ;

# Integer
sh:datatype xsd:integer ;

# Boolean
sh:datatype xsd:boolean ;

# DateTime
sh:datatype xsd:dateTime ;

# URI
sh:datatype xsd:anyURI ;
```

### Pattern Matching

```turtle
# UUID pattern
sh:pattern "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" ;

# Semver pattern
sh:pattern "^\\d+\\.\\d+\\.\\d+" ;
```

### Value Ranges

```turtle
# Integer range: 0-10
sh:minInclusive 0 ;
sh:maxInclusive 10 ;
sh:datatype xsd:integer ;

# String minimum length
sh:minLength 1 ;
```

### Allowed Values (Enumeration)

```turtle
sh:in (
  "pending"^^xsd:string
  "claimed"^^xsd:string
  "in-progress"^^xsd:string
  "completed"^^xsd:string
  "failed"^^xsd:string
  "cancelled"^^xsd:string
) ;
```

## Nested Block Detection

The validator handles nested SHACL blocks (`sh:eachItemShape`, `sh:nodeShape`) by:

1. Tracking bracket depth when entering a nested block
2. Skipping all content inside nested blocks (not implementing recursive validation)
3. Setting constraints on the parent field (e.g., `datatype: 'array'`)

This is necessary because:
- **capabilities**, **capabilityDetails**, **metadata**, **tags** are array fields in DAP
- The parser marks these as arrays when it encounters closing `]` brackets
- Nested property shapes inside array constraints are tracked but not recursively validated

```turtle
# capabilities is an array with at least 1 string item
sh:property [
  sh:path dap:capabilities ;
  sh:minCount 1 ;
  sh:eachItemShape [
    sh:datatype xsd:string ;
    sh:minLength 1 ;
  ] ;
  sh:message "capabilities is required and must contain at least one non-empty string" ;
] ;
```

## testMode Option

For unit tests that need to bypass SHACL validation, pass `{ testMode: true }` to the constructor:

```typescript
// Disable SHACL validation in tests
const registry = new AgentRegistry('./shapes', { testMode: true });

// With testMode: true, registration always succeeds (if TypeScript types pass)
registry.register('test-agent', agentInfo, mockSocket, []);
```

## Adding a New Field Constraint

### Step 1: Edit the TTL Shape

Add the field constraint to the appropriate shape file:

```turtle
# In shapes/job-shape.ttl
# Add deadline field as required ISO 8601 datetime

dap:JobShape a sh:NodeShape ;
  sh:property [
    sh:path dap:deadline ;
    sh:severity sh:Violation ;
    sh:message "deadline is required and must be a valid ISO 8601 datetime" ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:dateTime ;
  ] ;
  # ... existing properties ...
```

### Step 2: Restart Server

The SHACLValidator loads shapes at initialization. Restart the server to pick up changes:

```bash
# Restart the DAP relay server
npm run start
# or
ts-node src/relay/server.ts
```

### Step 3: Verify

Check shape loading:

```typescript
const validator = new SHACLValidator('./shapes');
const shapes = validator.getShapeInfo();
// Should show updated field counts

// Validate a job with the new field
const result = validator.validateJob({
  job_id: '550e8400-e29b-41d4-a716-446655440000',
  type: 'task',
  deadline: '2026-06-01T00:00:00Z',  // New required field
  // ...
});
```

## Validation Result Format

```typescript
interface ValidationError {
  path: string;           // Field name that failed
  message: string;        // Human-readable error message
  severity: 'error' | 'warning';
}

interface ValidationResult {
  valid: boolean;         // true if no error-level failures
  errors: ValidationError[];
  shape: string;          // Shape name used (e.g., 'agent-shape')
}
```

## Limitations

The SHACL implementation is **partial** — not all SHACL 1.1 features are supported:

| Feature | Status | Notes |
|---------|--------|-------|
| `sh:path` | ✅ Supported | Basic property paths |
| `sh:minCount` / `sh:maxCount` | ✅ Supported | Cardinality constraints |
| `sh:datatype` | ✅ Supported | string, integer, boolean, datetime, anyURI |
| `sh:pattern` | ✅ Supported | Regex validation |
| `sh:minLength` | ✅ Supported | String length |
| `sh:minInclusive` / `sh:maxInclusive` | ✅ Supported | Numeric ranges |
| `sh:in` | ✅ Supported | Value enumeration |
| `sh:severity` | ⚠️ Parsed | Used for logging, not filtering |
| `sh:nodeKind` | ⚠️ Parsed | Not enforced |
| `sh:eachItemShape` | ⚠️ Detected | Marks array, items not recursively validated |
| `sh:nodeShape` | ⚠️ Detected | Nested shapes not recursively validated |
| `sh:or` | ❌ Not implemented | Multiple possible shapes |
| `sh:and` | ❌ Not implemented | Conjunction of shapes |
| `sh:not` | ❌ Not implemented | Negation |
| `sh:sparql` | ❌ Not implemented | SPARQL-based constraints |
| `sh:qualifiedValueShape` | ❌ Not implemented | Qualified cardinality |
| `sh:hasValue` | ❌ Not implemented | Must equal specific value |
| Cross-field constraints | ❌ Not implemented | Enforced in TypeScript code instead |

### What to Do Instead

For features not implemented in the SHACL validator:

1. **Complex constraints**: Add validation in TypeScript after SHACL passes
2. **Cross-field validation**: Implement in `job-queue.ts` or `agent-registry.ts`
3. **Custom validators**: Create separate validation functions in `src/validation/`

Example: enforcing that `completed_at > started_at`:

```typescript
// In job-queue.ts - not in SHACL
if (job.completed_at && job.started_at) {
  if (new Date(job.completed_at) <= new Date(job.started_at)) {
    throw new Error('completed_at must be after started_at');
  }
}
```