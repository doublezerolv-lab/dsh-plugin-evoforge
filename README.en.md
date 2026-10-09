# DSH EvoForge

[![verify](https://github.com/doublezerolv-lab/dsh-plugin-evoforge/actions/workflows/ci.yml/badge.svg)](https://github.com/doublezerolv-lab/dsh-plugin-evoforge/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Turn recurring tasks into reusable tools and skills.**

EvoForge is a Tool / Skill evolution plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It identifies capability gaps, repeated code and reusable workflows from task trajectories, generates candidates, and adds verified, human-approved capabilities to Harness for use in later sessions.

[中文](README.md) · [Tutorial](docs/tutorial.md) · [Configuration example](examples/generation.patch.yml) · [Architecture](docs/architecture.md)

## Features

- **Task observation**: capture session events, tool calls, elapsed time and token usage, with persistent trajectories and replay.
- **Capability discovery**: detect missing tools, repeated code, multi-step workflows, slow calls and execution failures.
- **Tool and Skill generation**: use a model configured in Harness to generate TypeScript tools with JSON inputs and outputs, or reusable Skill workflows, with generation budgets and bounded repair attempts.
- **Verification and approval**: check tool candidates against independent samples in a Docker sandbox, then review and approve them before activation.
- **Reuse across sessions**: register approved capabilities with the Harness Tool / Skill Registry, persist them across restarts, and make them available in new sessions.
- **Version and cost management**: deduplication, versioning, retirement, rollback, usage statistics, and decisions to create, reuse, improve, retire or defer capabilities.

**Observe mode** is the default. Enable generation when ready; candidates still require verification and human approval before activation. Trajectories omit prompt and output bodies by default and redact sensitive fields.

## Use cases

- Turn recurring log analysis and text parsing code into reusable tools.
- Package common multi-step tasks as Skills for later tasks.
- Manage Agent capabilities through candidate review, approval, version history and usage statistics.

## Workflow

Observe tasks → Identify reusable capabilities → Generate candidates → Verify samples → Approve → Reuse

Tool candidates execute in Docker containers with networking disabled, a non-root user, a read-only root filesystem, and resource and time limits. Skills support workflow contract and tool dependency checks.

## Quick start

Requires Node.js 22+, npm and DeepSeek Harness. Tool execution and verification require Docker Linux containers.

### Build and install

Clone this repository and run from the project directory:

```sh
npm ci --ignore-scripts
npm run build
dsh plugin --profile YOUR_PROFILE add /absolute/path/to/dsh-plugin-evoforge
```

Replace the profile and path with your own. For Desktop installation, see the [tutorial](docs/tutorial.md).

### Enable generation

EvoForge uses model routes already configured in Harness, including DeepSeek account login. Set `provider` and `model` using the [generation configuration example](examples/generation.patch.yml), then enable:

```yaml
enableGeneration: true
autoEvolution: true
requireApproval: true
```

With DeepSeek account login, EvoForge needs no separate API key. See the [account configuration example](examples/deepseek-account.patch.yml).

### Manage tools

This example uses `.evoforge` as its storage directory. To manage an installed plugin, use its configured `storageDir`.

```sh
docker build -t evoforge-sandbox:1 sandbox
node dist/cli.js import examples/log-parser.json --storage .evoforge
node dist/cli.js verify tool:evoforge-log-summary@1 --storage .evoforge
node dist/cli.js show tool:evoforge-log-summary@1 --storage .evoforge
node dist/cli.js approve tool:evoforge-log-summary@1 --reviewer YOUR_NAME --storage .evoforge
```

Harness loads the approved tool when using the same storage directory. The Agent can select it for tasks such as counting INFO, WARN, ERROR and malformed log lines.

The CLI also provides `analyze`, `list`, `samples`, `retire`, `rollback`, `audit` and `export-skill`. See the [tutorial](docs/tutorial.md) for details.

## Compatibility

| DeepSeek Harness | Cordis |
| --- | --- |
| `0.2.0-rc.2` | `4.0.4` |
| `0.2.1-alpha.1` | `4.0.5-alpha.1` |

Use matching DSH dependency versions in the same environment.

## Development

```sh
npm run check
npm run demo
```

## License

[MIT](LICENSE)
