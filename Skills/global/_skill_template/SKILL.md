---
name: "[Skill Name]"
description: "[What this skill does in one sentence]"
version: "1.0.0"
target_connector: "[connector filename without .ts, e.g., notebooklm_connector]"
required_env_vars:
  - "API_KEY_NAME"
trigger_conditions:
  - "When Antigravity needs [specific capability]"
  - "When a task mentions [keyword or pattern]"
token_budget:
  max_input_tokens: 4000
  max_output_tokens: 2000
  max_total_cost_usd: 0.10
sandbox_mode: true
---

# [Skill Name]

## Purpose
[Detailed description of what this skill accomplishes, when to use it, and expected outcomes.]

## Inputs
| Parameter | Type | Required | Description |
|---|---|---|---|
| param_1 | string | Yes | [Description] |
| param_2 | string[] | No | [Description] |

## Outputs
| Field | Type | Description |
|---|---|---|
| output_1 | string | [Description] |
| output_2 | object | [Description] |

## Workflow
1. [Step 1: What happens first]
2. [Step 2: What happens next]
3. [Step 3: How results are returned]

## Error Handling
- **Auth failure:** [What to do]
- **Timeout:** [What to do]
- **Rate limit:** [What to do]

## Example Usage
```typescript
// How NanoClaw invokes this skill
const connector = new SomeConnector(config, sandbox);
await connector.pull({ param_1: "value" });
```

## Changelog
- **v1.0.0** — Initial skill creation
