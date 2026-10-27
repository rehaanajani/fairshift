import { describe, expect, it } from "vitest";
import { GENESIS, firstBroken, receiptCode, seal, type Receipt } from "../server/ledger.ts";

process.env.FAIRSHIFT_AI = "off";

function receipt(shiftId: string): Omit<Receipt, "hash" | "prev"> {
  return {
    orgId: "orion",
    workerId: "w1",
    shiftId,
    start: "2026-10-26T02:30:00.000Z",
    end: "2026-10-26T10:30:00.000Z",
    hours: 8,
    overtime: 0,
    kind: "shift",
    by: "worker",
    at: "2026-10-26T10:30:00.000Z",
  };
}

function chain() {
  const receipts: Receipt[] = [];
  for (const id of ["s1", "s2", "s3"]) receipts.push(seal(receipts, receipt(id)));
  return receipts;
}

describe("receipt hash chain", () => {
  it("seals the first receipt against genesis and each next receipt against its predecessor", () => {
    const receipts = chain();
    expect(receipts[0]!.prev).toBe(GENESIS);
    expect(receipts[1]!.prev).toBe(receipts[0]!.hash);
    expect(receipts[2]!.prev).toBe(receipts[1]!.hash);
    expect(new Set(receipts.map((r) => r.hash)).size).toBe(3);
    for (const r of receipts) expect(r.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic and leaves appending to the caller", () => {
    const receipts = chain();
    const before = structuredClone(receipts);
    expect(seal(receipts, receipt("s4"))).toEqual(seal(receipts, receipt("s4")));
    expect(receipts).toEqual(before);
  });

  it("returns -1 for empty and intact chains", () => {
    expect(firstBroken([])).toBe(-1);
    expect(firstBroken(chain())).toBe(-1);
  });

  it.each([0, 1, 2])("reports index %i when that receipt's hours are altered", (index) => {
    const receipts = chain();
    receipts[index]!.hours = 7;
    expect(firstBroken(receipts)).toBe(index);
  });

  it("detects a broken predecessor link", () => {
    const receipts = chain();
    receipts[1]!.prev = GENESIS;
    expect(firstBroken(receipts)).toBe(1);
  });
});

describe("receiptCode", () => {
  it("formats the first eight hash characters as FS-XXXX-XXXX in uppercase", () => {
    expect(receiptCode("abcdef0123456789")).toBe("FS-ABCD-EF01");
    for (const r of chain()) expect(receiptCode(r.hash)).toMatch(/^FS-[0-9A-F]{4}-[0-9A-F]{4}$/);
  });
});
