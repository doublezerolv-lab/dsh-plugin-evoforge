"""Export measured benchmark artifacts; requires matplotlib, never estimates tokens."""
import json
import sys
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

directory = Path(sys.argv[1] if len(sys.argv) > 1 else "artifacts/benchmark-mock")
report = json.loads((directory / "results.json").read_text(encoding="utf-8"))
rows = report["summaries"]
labels = [row["group"] for row in rows]
colors = ["#64748b", "#b45309", "#0369a1"]
fig, axes = plt.subplots(1, 2, figsize=(11, 4.6), layout="constrained")
fig.suptitle("EvoForge: executed mock benchmark (12 shared tasks)", fontsize=15)
elapsed = [max(0.001, row["elapsedMs"]) for row in rows]
axes[0].bar(labels, elapsed, color=colors)
axes[0].set_yscale("log")
axes[0].set_ylabel("Total measured milliseconds (log scale)")
axes[0].set_title("Full cost including generation and verification")
for index, value in enumerate(elapsed):
    axes[0].text(index, value * 1.2, f"{value:,.2f}", ha="center", fontsize=10)
axes[0].set_ylim(min(elapsed) / 2, max(elapsed) * 5)
attempts = [row["generationAttempts"] for row in rows]
axes[1].bar(labels, attempts, color=colors)
axes[1].set_ylabel("Observed generation attempts")
axes[1].set_title("Persistence avoids repeated mock synthesis")
axes[1].set_ylim(0, max(attempts) + 2)
for index, value in enumerate(attempts):
    axes[1].text(index, value + 0.25, str(value), ha="center", fontsize=10)
for axis in axes:
    axis.spines[["top", "right"]].set_visible(False)
    axis.grid(axis="y", alpha=0.15)
    axis.set_axisbelow(True)
fig.supxlabel("Mock model + trusted fixture executor. Token/currency costs unavailable; no LLM efficacy claim.", fontsize=10)
fig.savefig(directory / "benchmark.png", dpi=180)
fig.savefig(directory / "benchmark.svg")
print(directory / "benchmark.png")
