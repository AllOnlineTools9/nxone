/**
 * A ZIP file, written by hand.
 *
 * An accountant should receive one attachment, not six. Every library that does this is bigger
 * than the problem: a ZIP holding files that are stored rather than compressed is a header, the
 * bytes, and a table at the end saying where each one started. The only arithmetic of substance
 * is the CRC-32, and spreadsheets open the result the same as any other archive.
 *
 * Deliberately plain: no compression, no folders beyond a prefix in the name, no encryption,
 * no zip64. A books pack is a few hundred kilobytes of text, and none of that would earn its
 * keep.
 */

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** The path inside the archive, e.g. "september/profit-and-loss.csv". */
  name: string;
  /** Text files only, which is all a books pack holds. */
  text: string;
}

/** MS-DOS date and time, which is what a ZIP records: two bytes each, seconds in steps of two. */
function dosStamp(when: Date): { date: number; time: number } {
  const year = Math.max(1980, when.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
    time: (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1)
  };
}

class Writer {
  private parts: Uint8Array[] = [];
  length = 0;

  push(bytes: Uint8Array) { this.parts.push(bytes); this.length += bytes.length; }

  /** Little-endian, which is the only byte order a ZIP uses. */
  record(...fields: Array<[number, 2 | 4]>) {
    const size = fields.reduce((n, [, width]) => n + width, 0);
    const out = new Uint8Array(size);
    const view = new DataView(out.buffer);
    let at = 0;
    for (const [value, width] of fields) {
      if (width === 2) view.setUint16(at, value & 0xffff, true);
      else view.setUint32(at, value >>> 0, true);
      at += width;
    }
    this.push(out);
    return out;
  }

  join(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const p of this.parts) { out.set(p, at); at += p.length; }
    return out;
  }
}

export function makeZip(entries: ZipEntry[], when = new Date()): Uint8Array {
  const encoder = new TextEncoder();
  const { date, time } = dosStamp(when);
  const body = new Writer();
  const directory = new Writer();
  const written: Array<{ name: Uint8Array; crc: number; size: number; at: number }> = [];

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = encoder.encode(entry.text);
    const crc = crc32(data);
    const at = body.length;

    body.record(
      [0x04034b50, 4], // local file header
      [20, 2],         // version needed
      [0x0800, 2],     // flags: the name is UTF-8
      [0, 2],          // stored, not compressed
      [time, 2], [date, 2],
      [crc, 4], [data.length, 4], [data.length, 4],
      [name.length, 2], [0, 2]
    );
    body.push(name);
    body.push(data);
    written.push({ name, crc, size: data.length, at });
  }

  for (const file of written) {
    directory.record(
      [0x02014b50, 4], // central directory header
      [20, 2], [20, 2], [0x0800, 2], [0, 2],
      [time, 2], [date, 2],
      [file.crc, 4], [file.size, 4], [file.size, 4],
      [file.name.length, 2], [0, 2], [0, 2], [0, 2], [0, 2],
      [0, 4],          // external attributes
      [file.at, 4]     // where the local header is
    );
    directory.push(file.name);
  }

  const end = new Writer();
  end.record(
    [0x06054b50, 4], // end of central directory
    [0, 2], [0, 2],
    [written.length, 2], [written.length, 2],
    [directory.length, 4], [body.length, 4],
    [0, 2]
  );

  const out = new Uint8Array(body.length + directory.length + end.length);
  out.set(body.join(), 0);
  out.set(directory.join(), body.length);
  out.set(end.join(), body.length + directory.length);
  return out;
}
