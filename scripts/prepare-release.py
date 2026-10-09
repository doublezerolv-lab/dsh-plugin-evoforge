"""Build a source archive from explicit public paths, excluding local runtime data."""
from pathlib import Path
import json
import zipfile

root = Path(__file__).resolve().parent.parent
package = json.loads((root / "package.json").read_text(encoding="utf-8"))
public_files = ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json",
                "README.md", "README.en.md", "LICENSE", "PLAN.md", ".gitignore",
                "cordis.patch.yml", "dev.cmd"]
public_dirs = ["src", "tests", "docs", "examples", "benchmark", "scripts", "sandbox", ".github"]
selected = [root / name for name in public_files]
for name in public_dirs:
    selected.extend(p for p in (root / name).rglob("*") if p.is_file()
                    and not any(part in {"__pycache__", "node_modules"} for part in p.relative_to(root).parts)
                    and not p.name.startswith(".env") and p.suffix not in {".tmp", ".pyc", ".log"})
out = root / "artifacts" / f"{package['name']}-{package['version']}-source.zip"
out.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for file in sorted(set(selected)):
        archive.write(file, f"{package['name']}/{file.relative_to(root).as_posix()}")
with zipfile.ZipFile(out) as archive:
    names = archive.namelist()
    assert not any("/artifacts/" in name or "/.evoforge/" in name or "/node_modules/" in name for name in names)
print(json.dumps({"file": out.name, "files": len(names), "bytes": out.stat().st_size}))
