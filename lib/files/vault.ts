/**
 * The paperwork that goes with the money: a supplier's bill, a signed contract, a photo of a
 * delivery note.
 *
 * Two decisions shape this. The files are kept in IndexedDB rather than with the rest of the
 * books, because a few PDFs would fill the small box the books live in and take the books down
 * with them. And only the fact of a file - its name, size and type - is kept with the record;
 * the bytes stay on the device they were added on. A file that cannot be on another device is
 * better said out loud than quietly missing, so every screen that shows one says where it lives.
 */

export interface Attachment {
  id: string;
  name: string;
  /** The media type the browser reported, used to open it again. */
  type: string;
  size: number;
  addedAt: string;
}

/** Big enough for a scanned bill, small enough that a phone photo gets resized first. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** What one business may keep on one device before it has to tidy up. */
export const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

export class VaultFull extends Error {
  constructor(public needed: number, public free: number) {
    super("There is no room left for this file on this device.");
    this.name = "VaultFull";
  }
}

export class FileTooBig extends Error {
  constructor(public size: number) {
    super("That file is too big to keep here.");
    this.name = "FileTooBig";
  }
}

/** What a vault needs underneath it. IndexedDB in a browser, a map in a test. */
export interface VaultBackend {
  put(id: string, blob: Blob): Promise<void>;
  get(id: string): Promise<Blob | undefined>;
  remove(id: string): Promise<void>;
  keys(): Promise<string[]>;
  sizes(): Promise<Record<string, number>>;
}

export class MemoryBackend implements VaultBackend {
  private files = new Map<string, Blob>();
  async put(id: string, blob: Blob) { this.files.set(id, blob); }
  async get(id: string) { return this.files.get(id); }
  async remove(id: string) { this.files.delete(id); }
  async keys() { return [...this.files.keys()]; }
  async sizes() { return Object.fromEntries([...this.files].map(([k, v]) => [k, v.size])); }
}

const DB_NAME = "nxone-files";
const STORE = "files";

/** The browser's own file store. Opened lazily, because most sessions never attach anything. */
export class IdbBackend implements VaultBackend {
  private db?: Promise<IDBDatabase>;

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    return this.db;
  }

  private async run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = work(transaction.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async put(id: string, blob: Blob) { await this.run("readwrite", (s) => s.put(blob, id) as IDBRequest<IDBValidKey>); }
  async get(id: string) { return (await this.run("readonly", (s) => s.get(id) as IDBRequest<Blob | undefined>)) ?? undefined; }
  async remove(id: string) { await this.run("readwrite", (s) => s.delete(id) as IDBRequest<undefined>); }
  async keys() { return (await this.run("readonly", (s) => s.getAllKeys() as IDBRequest<IDBValidKey[]>)).map(String); }

  async sizes() {
    const out: Record<string, number> = {};
    for (const key of await this.keys()) out[key] = (await this.get(key))?.size ?? 0;
    return out;
  }
}

const newId = () => `fi_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export class Vault {
  constructor(private backend: VaultBackend) {}

  /** Keep a file, and hand back what the record should remember about it. */
  async add(file: { name: string; type: string; size: number; blob: Blob }): Promise<Attachment> {
    if (file.size > MAX_FILE_BYTES) throw new FileTooBig(file.size);

    const used = await this.usedBytes();
    if (used + file.size > MAX_TOTAL_BYTES) throw new VaultFull(file.size, Math.max(0, MAX_TOTAL_BYTES - used));

    const id = newId();
    await this.backend.put(id, file.blob);
    return { id, name: file.name, type: file.type || "application/octet-stream", size: file.size, addedAt: new Date().toISOString() };
  }

  async open(id: string): Promise<Blob | undefined> { return this.backend.get(id); }
  async remove(id: string): Promise<void> { return this.backend.remove(id); }
  async has(id: string): Promise<boolean> { return Boolean(await this.backend.get(id)); }

  async usedBytes(): Promise<number> {
    const sizes = await this.backend.sizes();
    return Object.values(sizes).reduce((a, b) => a + b, 0);
  }

  async usage(): Promise<{ bytes: number; files: number; freeBytes: number; fullness: number }> {
    const sizes = await this.backend.sizes();
    const bytes = Object.values(sizes).reduce((a, b) => a + b, 0);
    return {
      bytes,
      files: Object.keys(sizes).length,
      freeBytes: Math.max(0, MAX_TOTAL_BYTES - bytes),
      fullness: Math.min(1, bytes / MAX_TOTAL_BYTES)
    };
  }

  /**
   * Files no record points at any more, which is what is left when a bill is deleted. Removing
   * them is deliberate rather than automatic: a file is somebody's paperwork, and silently
   * deleting paperwork is not a tidy-up, it is a loss.
   */
  async orphans(keep: string[]): Promise<string[]> {
    const held = new Set(keep);
    return (await this.backend.keys()).filter((id) => !held.has(id));
  }
}

/** Sizes people can read, which is the only kind worth showing. */
export function describeSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** The one the app uses. Tests build their own on a memory backend. */
export const vault = new Vault(typeof indexedDB === "undefined" ? new MemoryBackend() : new IdbBackend());
