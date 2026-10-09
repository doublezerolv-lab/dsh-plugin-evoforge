# DSH EvoForge

[![verify](https://github.com/doublezerolv-lab/dsh-plugin-evoforge/actions/workflows/ci.yml/badge.svg)](https://github.com/doublezerolv-lab/dsh-plugin-evoforge/actions/workflows/ci.yml) · MIT · Experimental early release

An auditable Tool and Skill evolution bundle for DeepSeek Harness. Observe mode is the default. Generated capabilities remain private until independently verified and explicitly approved by a human.

Verified runtime pairs: DSH `0.2.0-rc.2` / Cordis `4.0.4`, and DSH `0.2.1-alpha.1` / Cordis `4.0.5-alpha.1`. Peer declarations allow only these exact versions; development dependencies remain pinned to the alpha pair. Inspected the installed Desktop runtime and upstream commit `5badb15009ae1756c3afe0ae0cef1faafc290ccc`. No Harness core modifications.

The plugin uses the real `session/event` feed, `ctx.tools.register()`, `ctx.skills.register()` and `ctx.llm.stream()` APIs. It adds redacted trajectories, rule-based gap detection, explainable cost-aware evolution, bounded synthesis/repair, Docker verification, atomic versioned persistence and a human CLI approval boundary. Official registries retain ownership of tool execution and skill discovery.

```sh
npm ci --ignore-scripts
npm run check
npm run demo
npm run benchmark
npm pack --pack-destination artifacts
```

On this Windows workspace, `dev.cmd check`, `dev.cmd demo` and `dev.cmd benchmark` also use the prepared portable Node distribution. The demo uses real Cordis and Session services with explicitly authored example events.

Install into a matching test profile:

```sh
dsh plugin --profile YOUR_TEST_PROFILE add /absolute/path/to/dsh-plugin-evoforge
dsh --profile YOUR_TEST_PROFILE --dump-config
```

For generated tools, prepare the trusted Linux sandbox image explicitly:

```sh
docker build -t evoforge-sandbox:1 sandbox
node dist/cli.js import examples/log-parser.json
node dist/cli.js verify tool:evoforge-log-summary@1
node dist/cli.js approve tool:evoforge-log-summary@1 --reviewer YOUR_NAME
```

Without Docker, executable verification fails closed. Generated code never runs on the host. Containers disable networking, use a read-only root, drop capabilities, run as a non-root user, and enforce memory, CPU, process, output and time bounds. Only an isolated temporary artifact directory is mounted. `requireApproval: false` is rejected in this release.

The mock benchmark executes identical independently scored tasks across Baseline, ephemeral CodeGen and persisted EvoForge strategies. It measures real implementation elapsed time, generation attempts, reuse and prompt bytes. The mock executor runs trusted authored logic instead of generated source. Mock proofs cannot activate executable tools. Unknown token and monetary costs are `null`; these results provide no claim about LLM efficacy. Cold generation and later reuse costs are reported separately, including overhead unfavorable to EvoForge.

Both supported runtime pairs pass all 23 tests with Docker enabled, including actual container execution and hard deadline cleanup. Docker tests remain opt-in. Skill checks validate workflow contracts, not model adherence. See [architecture](docs/architecture.md), [tutorial](docs/tutorial.md), [benchmark methodology](docs/benchmark.md) and [delivery status](docs/status.md).

Human-specified real generation and reuse pass: the installed Harness account adapter generated a log Tool that passed four independent Docker samples. After the user approved this exact candidate, Agents in two new Sessions called it successfully and produced the expected counts. The first task named the Tool; the second did not, and the Agent selected it itself. Registry uses/successes are both 2; event elapsed times were 938 and 3386 ms. The first generation response failed JSON parsing; both generation calls totalled 3210 measured tokens. These are individual log-task results, not general success-rate or performance claims. Autonomous gap-triggered generation and full Agent benchmarks remain unverified. See [live validation](docs/live-validation.md).

MIT License. The npm package is not published; build and install locally using the tutorial. Account calls may consume quota; monetary cost is unknown.
