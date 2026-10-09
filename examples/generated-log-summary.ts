export function run(input: any): any {
  const text = input && typeof input.text === "string" ? input.text : "";
  const counts = { INFO: 0, WARN: 0, ERROR: 0 };
  let malformed = 0;
  const lines = text.split(/\r?\n/);
  const valid = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z) (INFO|WARN|ERROR) (.+)$/;
  for (const line of lines) {
    if (line.trim() === "") continue;
    const match = valid.exec(line);
    if (match) {
      counts[match[2] as keyof typeof counts] += 1;
    } else {
      malformed += 1;
    }
  }
  return { counts, malformed };
}
