# Example Workflows

This directory contains example workflows you can import into Hive to get started quickly.

## Available Workflows

| File                            | Description                                |
| ------------------------------- | ------------------------------------------ |
| `add-tests.workflow.json`       | Add comprehensive tests for a module       |
| `refactor-legacy.workflow.json` | Modernize legacy code with better patterns |
| `new-feature.workflow.json`     | End-to-end new feature development         |

## How to Import

1. Open Hive and go to the **Workflows** page
2. Click **Import** and select a `.workflow.json` file
3. The workflow will appear in your workflows list
4. Click **Run** to execute it

## Creating Your Own Workflows

Workflows are JSON files with this structure:

```json
{
  "name": "Workflow Name",
  "description": "What this workflow does",
  "nodes": [
    { "id": "1", "type": "trigger", "position": {"x": 100, "y": 100}, "data": {...} },
    { "id": "2", "type": "agentTask", "position": {"x": 100, "y": 250}, "data": {...} }
  ],
  "edges": [
    { "source": "1", "target": "2" }
  ]
}
```

### Node Types

| Type        | Description                                      |
| ----------- | ------------------------------------------------ |
| `trigger`   | Starts the workflow (manual, scheduled, webhook) |
| `agentTask` | Runs an AI agent with a prompt                   |
| `gate`      | Pauses for human approval                        |
| `parallel`  | Runs multiple branches simultaneously            |
| `tool`      | Executes a custom tool/script                    |
| `output`    | Marks workflow completion                        |

### Agent Task Configuration

```json
{
  "label": "Task Name",
  "prompt": "Instructions for the agent. Use {{input.variable}} for dynamic values.",
  "harness": "opencode|claude-code|pi|ollama-direct|lmstudio-direct",
  "model": "optional model override"
}
```

## Variables

Use `{{input.variableName}}` in prompts to reference values passed when starting the workflow. Define these in the trigger node's config.
