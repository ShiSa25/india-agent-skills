/**
 * Test-only QR decoder. It reads a module matrix produced by the vendored
 * Nayuki encoder (or the SVG that upiQrSvg prints) and returns the text.
 * It is permissive: a clean symbol is enough, and error correction is not repaired.
 */
import { qrcodegen } from '../scripts/_lib/vendor/qrcodegen.mjs';

const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

export function decodeQrSvg(svg) {
  const view = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  if (!view || view[1] !== view[2]) throw new Error('svg has no square viewBox');
  const width = Number(view[1]);
  const border = Number(/data-border="(\d+)"/.exec(svg)?.[1] ?? 4);
  const size = width - border * 2;
  if (size < 21 || (size - 17) % 4 !== 0) throw new Error('svg quiet zone does not leave a QR size');
  const modules = Array.from({ length: size }, () => Array(size).fill(false));
  for (const match of svg.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    const x = Number(match[1]) - border;
    const y = Number(match[2]) - border;
    if (y >= 0 && x >= 0 && y < size && x < size) modules[y][x] = true;
  }
  return decodeQrModules(modules);
}

export function decodeQrModules(modules) {
  const size = modules.length;
  if (modules.some((row) => row.length !== size)) throw new Error('QR matrix is not square');
  const version = (size - 17) / 4;
  if (!Number.isInteger(version) || version < 1 || version > 40) throw new Error('QR version is out of range');
  const format = readFormat(modules);
  const ecl = ECC_BY_FORMAT_BITS[format.eccBits];
  const isFunction = functionModules(version, size);
  const unmasked = modules.map((row) => row.slice());
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!isFunction[y][x] && maskInvert(format.mask, x, y)) unmasked[y][x] = !unmasked[y][x];
    }
  }
  const raw = readCodewords(unmasked, isFunction, version);
  const data = deinterleave(raw, version, ecl);
  return readPayload(data, version);
}

const ECC_BY_FORMAT_BITS = [
  qrcodegen.QrCode.Ecc.MEDIUM,
  qrcodegen.QrCode.Ecc.LOW,
  qrcodegen.QrCode.Ecc.HIGH,
  qrcodegen.QrCode.Ecc.QUARTILE,
];

function readFormat(modules) {
  const size = modules.length;
  const copies = [[], []];
  for (let i = 0; i <= 5; i += 1) copies[0].push(modules[i][8]);
  copies[0].push(modules[7][8], modules[8][8], modules[8][7]);
  for (let i = 9; i < 15; i += 1) copies[0].push(modules[8][14 - i]);
  for (let i = 0; i < 8; i += 1) copies[1].push(modules[8][size - 1 - i]);
  for (let i = 8; i < 15; i += 1) copies[1].push(modules[size - 15 + i][8]);
  for (const bits of copies) {
    const unpacked = unpackFormat(bits);
    if (unpacked) return unpacked;
  }
  throw new Error('QR format information did not check');
}

function unpackFormat(bits) {
  let masked = 0;
  for (let i = 0; i < bits.length; i += 1) if (bits[i]) masked |= 1 << i;
  const code = masked ^ 0x5412;
  const data = code >>> 10;
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  if ((rem & 0x3ff) !== (code & 0x3ff)) return null;
  return { eccBits: data >>> 3, mask: data & 7 };
}

function functionModules(version, size) {
  const markAt = Array.from({ length: size }, () => Array(size).fill(false));
  const mark = (x, y) => {
    if (x >= 0 && y >= 0 && x < size && y < size) markAt[y][x] = true;
  };
  for (let i = 0; i < size; i += 1) {
    mark(6, i);
    mark(i, 6);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) mark(cx + dx, cy + dy);
    }
  }
  const positions = alignmentPositions(version, size);
  for (let i = 0; i < positions.length; i += 1) {
    for (let j = 0; j < positions.length; j += 1) {
      if ((i === 0 && j === 0) || (i === 0 && j === positions.length - 1) || (i === positions.length - 1 && j === 0)) {
        continue;
      }
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) mark(positions[i] + dx, positions[j] + dy);
      }
    }
  }
  for (let i = 0; i < 9; i += 1) {
    mark(i, 8);
    mark(8, i);
  }
  for (let i = 0; i < 8; i += 1) mark(size - 1 - i, 8);
  for (let i = 0; i < 7; i += 1) mark(8, size - 7 + i);
  mark(8, size - 8);
  if (version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      mark(a, b);
      mark(b, a);
    }
  }
  return markAt;
}

function alignmentPositions(version, size) {
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

function maskInvert(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return (x * y) % 2 + (x * y) % 3 === 0;
    case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
    case 7: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
    default: throw new Error(`bad mask ${mask}`);
  }
}

function readCodewords(modules, isFunction, version) {
  const size = modules.length;
  const total = Math.floor(qrcodegen.QrCode.getNumRawDataModules(version) / 8);
  const bytes = [];
  let current = 0;
  let bits = 0;
  const pushBit = (dark) => {
    current = (current << 1) | (dark ? 1 : 0);
    bits += 1;
    if (bits === 8) {
      bytes.push(current);
      current = 0;
      bits = 0;
    }
  };
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y][x] && bytes.length < total) pushBit(modules[y][x]);
      }
    }
  }
  if (bytes.length !== total) throw new Error(`read ${bytes.length} codewords, expected ${total}`);
  return bytes;
}

function deinterleave(raw, version, ecl) {
  const qr = qrcodegen.QrCode;
  const numBlocks = qr.NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][version];
  const blockEccLen = qr.ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][version];
  const rawCodewords = Math.floor(qr.getNumRawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const padIndex = shortBlockLen - blockEccLen;
  const blocks = Array.from({ length: numBlocks }, () => []);
  let cursor = 0;
  for (let i = 0; i < shortBlockLen + 1; i += 1) {
    for (let j = 0; j < numBlocks; j += 1) {
      if (i === padIndex && j < numShortBlocks) blocks[j].push(0);
      else blocks[j].push(raw[cursor]);
      if (!(i === padIndex && j < numShortBlocks)) cursor += 1;
    }
  }
  if (cursor !== raw.length) throw new Error('QR blocks did not consume every codeword');
  const data = [];
  for (let j = 0; j < numBlocks; j += 1) {
    const dataLen = shortBlockLen - blockEccLen + (j < numShortBlocks ? 0 : 1);
    data.push(...blocks[j].slice(0, dataLen));
  }
  return data;
}

function readPayload(bytes, version) {
  const reader = new BitReader(bytes);
  let text = '';
  while (reader.remaining() >= 4) {
    const mode = reader.read(4);
    if (mode === 0) break;
    const count = reader.read(countBits(mode, version));
    if (mode === 0x1) text += readNumeric(reader, count);
    else if (mode === 0x2) text += readAlphanumeric(reader, count);
    else if (mode === 0x4) text += readBytes(reader, count);
    else if (mode === 0x7) skipEci(reader);
    else throw new Error(`unsupported QR mode ${mode}`);
  }
  return text;
}

function countBits(mode, version) {
  const table = {
    0x1: [10, 12, 14],
    0x2: [9, 11, 13],
    0x4: [8, 16, 16],
    0x7: [0, 0, 0],
    0x8: [8, 10, 12],
  };
  const row = table[mode];
  if (!row) throw new Error(`unsupported QR mode ${mode}`);
  return row[Math.floor((version + 7) / 17)];
}

function readNumeric(reader, count) {
  let out = '';
  let left = count;
  while (left >= 3) {
    out += reader.read(10).toString().padStart(3, '0');
    left -= 3;
  }
  if (left === 2) out += reader.read(7).toString().padStart(2, '0');
  else if (left === 1) out += reader.read(4).toString();
  return out;
}

function readAlphanumeric(reader, count) {
  let out = '';
  let left = count;
  while (left >= 2) {
    const value = reader.read(11);
    out += ALNUM[Math.floor(value / 45)] + ALNUM[value % 45];
    left -= 2;
  }
  if (left === 1) out += ALNUM[reader.read(6)];
  return out;
}

function readBytes(reader, count) {
  const bytes = [];
  for (let i = 0; i < count; i += 1) bytes.push(reader.read(8));
  return Buffer.from(bytes).toString('utf8');
}

function skipEci(reader) {
  const first = reader.read(1);
  if (first === 0) {
    reader.read(7);
    return;
  }
  const second = reader.read(1);
  if (second === 0) {
    reader.read(14);
    return;
  }
  reader.read(1);
  reader.read(21);
}

class BitReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.at = 0;
  }

  remaining() {
    return this.bytes.length * 8 - this.at;
  }

  read(count) {
    if (count > this.remaining()) throw new Error('QR payload ended early');
    let value = 0;
    for (let i = 0; i < count; i += 1) {
      const bit = (this.bytes[this.at >> 3] >> (7 - (this.at & 7))) & 1;
      value = (value << 1) | bit;
      this.at += 1;
    }
    return value;
  }
}
