"""Scan the exact staged Git files; print locations, never suspected values."""
from pathlib import Path
import argparse
import json
import re
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("--git", default="git")
parser.add_argument("--manifest", help="JSON array of the exact public source paths, for API publication")
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
if args.manifest:
    paths = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
else:
    result = subprocess.run([args.git, "ls-files", "--cached", "-z"], cwd=root, check=True, capture_output=True)
    paths = [p for p in result.stdout.decode("utf-8").split("\0") if p]
if not paths:
    raise SystemExit("No staged source files to audit")
blocked_parts = {"artifacts", "node_modules", ".evoforge", ".dsh", ".tools", ".reference", "__pycache__"}
blocked_names = {".credentials.yaml", ".credentials.yml", "hosts.yml"}
blocked_suffixes = {".pem", ".key", ".p12", ".pfx", ".pyc", ".tgz", ".zip", ".log"}
patterns = {
    "GitHub token": re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b"),
    "API key": re.compile(r"\bsk-(?:(?:proj|svcacct)-)?[A-Za-z0-9_-]{20,}\b"),
    "JWT": re.compile(r"\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b"),
    "private key": re.compile(r"^-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----", re.M),
    "credential URL": re.compile(r"https?://[^\s/:]+:[^\s/@]+@"),
    "literal secret": re.compile(r'''(?i)["']?(?:api[_-]?key|access[_-]?token|auth[_-]?token|password)["']?\s*[:=]\s*["'][^"'\r\n]{16,}["']'''),
}
findings = []
for relative in paths:
    path = root / relative
    if not path.resolve().is_relative_to(root.resolve()) or path.is_symlink():
        findings.append({"file": relative, "kind": "path escapes public project"})
        continue
    parts = Path(relative).parts
    if set(parts) & blocked_parts or path.name in blocked_names or path.suffix.lower() in blocked_suffixes or (path.name.startswith(".env") and path.name != ".env.example"):
        findings.append({"file": relative, "kind": "excluded local or credential file"})
        continue
    text = path.read_text(encoding="utf-8")
    for kind, pattern in patterns.items():
        for match in pattern.finditer(text):
            findings.append({"file": relative, "line": text[:match.start()].count("\n") + 1, "kind": kind})
print(json.dumps({"filesScanned": len(paths), "findings": findings}, ensure_ascii=False))
if findings:
    raise SystemExit(1)
