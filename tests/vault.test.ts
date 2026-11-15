import { beforeEach, describe, expect, it } from "vitest";
import { describeSize, FileTooBig, MAX_FILE_BYTES, MAX_TOTAL_BYTES, MemoryBackend, Vault, VaultFull } from "@/lib/files/vault";

const file = (name: string, bytes: number, type = "application/pdf") => ({
  name, type, size: bytes, blob: new Blob([new Uint8Array(bytes)], { type })
});

describe("keeping a file with a record", () => {
  let vault: Vault;
  beforeEach(() => { vault = new Vault(new MemoryBackend()); });

  it("hands back what the record should remember, and nothing more", async () => {
    const kept = await vault.add(file("supplier-bill.pdf", 2048));
    expect(kept).toMatchObject({ name: "supplier-bill.pdf", type: "application/pdf", size: 2048 });
    expect(kept.id).toMatch(/^fi_/);
    expect(kept.addedAt).toBeTruthy();
  });

  it("gives the file back", async () => {
    const kept = await vault.add(file("bill.pdf", 512));
    const back = await vault.open(kept.id);
    expect(back?.size).toBe(512);
  });

  it("knows whether a file is on this device", async () => {
    const kept = await vault.add(file("bill.pdf", 512));
    expect(await vault.has(kept.id)).toBe(true);
    expect(await vault.has("fi_fromanotherdevice")).toBe(false);
  });

  it("gives every file its own place, even two with the same name", async () => {
    const one = await vault.add(file("bill.pdf", 10));
    const two = await vault.add(file("bill.pdf", 20));
    expect(one.id).not.toBe(two.id);
    expect((await vault.open(two.id))?.size).toBe(20);
  });

  it("names a type for a file whose own type the browser could not tell", async () => {
    const kept = await vault.add({ ...file("mystery", 10), type: "" });
    expect(kept.type).toBe("application/octet-stream");
  });

  it("removes one without touching the others", async () => {
    const one = await vault.add(file("a.pdf", 10));
    const two = await vault.add(file("b.pdf", 20));
    await vault.remove(one.id);
    expect(await vault.has(one.id)).toBe(false);
    expect(await vault.has(two.id)).toBe(true);
  });
});

describe("the limits, which exist because this is somebody's phone", () => {
  let vault: Vault;
  beforeEach(() => { vault = new Vault(new MemoryBackend()); });

  it("refuses a file too big to keep, and says how big it was", async () => {
    await expect(vault.add(file("huge.pdf", MAX_FILE_BYTES + 1))).rejects.toThrow(FileTooBig);
    try {
      await vault.add(file("huge.pdf", MAX_FILE_BYTES + 1));
    } catch (error) {
      expect((error as FileTooBig).size).toBe(MAX_FILE_BYTES + 1);
    }
  });

  it("accepts one right on the limit", async () => {
    await expect(vault.add(file("just-fits.pdf", MAX_FILE_BYTES))).resolves.toBeTruthy();
  });

  it("refuses once the device has had enough, and says how much room is left", async () => {
    for (let i = 0; i < 10; i += 1) await vault.add(file(`big-${i}.pdf`, MAX_FILE_BYTES));
    expect((await vault.usage()).bytes).toBe(MAX_TOTAL_BYTES);

    try {
      await vault.add(file("one-too-many.pdf", 1024));
      throw new Error("should have refused");
    } catch (error) {
      expect(error).toBeInstanceOf(VaultFull);
      expect((error as VaultFull).free).toBe(0);
    }
  });

  it("keeps nothing when it refuses, rather than half a file", async () => {
    await expect(vault.add(file("huge.pdf", MAX_FILE_BYTES + 1))).rejects.toThrow();
    expect((await vault.usage()).files).toBe(0);
  });

  it("reports how full it is", async () => {
    // a quarter of the budget, in files that are each within the per-file limit
    for (let i = 0; i < 5; i += 1) await vault.add(file(`a-${i}.pdf`, MAX_TOTAL_BYTES / 20));
    const usage = await vault.usage();
    expect(usage.files).toBe(5);
    expect(usage.fullness).toBeCloseTo(0.25);
    expect(usage.freeBytes).toBe(MAX_TOTAL_BYTES * 0.75);
  });
});

describe("files no record points at any more", () => {
  it("finds them without removing them, because paperwork is not litter", async () => {
    const vault = new Vault(new MemoryBackend());
    const kept = await vault.add(file("still-used.pdf", 10));
    const loose = await vault.add(file("bill-was-deleted.pdf", 10));

    const orphans = await vault.orphans([kept.id]);
    expect(orphans).toEqual([loose.id]);
    expect(await vault.has(loose.id)).toBe(true);
  });

  it("finds none when every file is still spoken for", async () => {
    const vault = new Vault(new MemoryBackend());
    const a = await vault.add(file("a.pdf", 10));
    const b = await vault.add(file("b.pdf", 10));
    expect(await vault.orphans([a.id, b.id])).toEqual([]);
  });
});

describe("sizes people can read", () => {
  it("writes them the way a person would say them", () => {
    expect(describeSize(512)).toBe("512 B");
    expect(describeSize(2048)).toBe("2 KB");
    expect(describeSize(1024 * 1024 * 2.5)).toBe("2.5 MB");
    expect(describeSize(1024 * 1024 * 42)).toBe("42 MB");
  });
});
