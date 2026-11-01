/** Minimal YAML frontmatter parser for the SKILL.md subset this repo uses. */

export function splitFrontmatter(text) {
  const normalised = text.replaceAll('\r\n', '\n');
  if (!normalised.startsWith('---\n')) throw new Error('SKILL.md must start with ---');
  const end = normalised.indexOf('\n---\n', 4);
  if (end === -1) throw new Error('SKILL.md frontmatter is not closed');
  return {
    raw: normalised.slice(4, end),
    body: normalised.slice(end + 5),
  };
}

export function parseFrontmatter(text) {
  const { raw, body } = splitFrontmatter(text);
  const data = {};
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const match = /^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/.exec(line);
    if (!match) throw new Error(`bad frontmatter line: ${line}`);
    const key = match[1];
    const value = match[2];
    if (value === '>-' || value === '>' || value === '|') {
      const block = [];
      i += 1;
      while (i < lines.length && (lines[i].startsWith('  ') || lines[i].trim() === '')) {
        block.push(lines[i].trim());
        i += 1;
      }
      i -= 1;
      data[key] = block.join(' ').replace(/\s+/g, ' ').trim();
    } else if (value.startsWith('{')) {
      data[key] = parseInlineMap(value);
    } else if (value === '') {
      const map = {};
      i += 1;
      while (i < lines.length && lines[i].startsWith('  ')) {
        const nested = /^  ([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/.exec(lines[i]);
        if (!nested) throw new Error(`bad nested frontmatter line: ${lines[i]}`);
        map[nested[1]] = unquote(nested[2].trim());
        i += 1;
      }
      i -= 1;
      data[key] = map;
    } else {
      data[key] = unquote(value.trim());
    }
  }
  return { data, body };
}

function parseInlineMap(value) {
  if (!value.endsWith('}')) throw new Error(`bad inline map: ${value}`);
  const inner = value.slice(1, -1).trim();
  const out = {};
  if (inner === '') return out;
  for (const part of inner.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
    const splitAt = part.indexOf(':');
    if (splitAt === -1) throw new Error(`bad inline map entry: ${part}`);
    const key = unquote(part.slice(0, splitAt).trim());
    out[key] = unquote(part.slice(splitAt + 1).trim());
  }
  return out;
}

function unquote(value) {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}
