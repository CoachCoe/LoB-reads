/**
 * @jest-environment node
 */
import { mapWithConcurrency } from "@/lib/concurrency";

describe("mapWithConcurrency", () => {
  it("preserves input order in the results", async () => {
    const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      // Later items finish sooner, so ordering can't come from completion time.
      await new Promise((resolve) => setTimeout(resolve, (6 - n) * 5));
      return n * 10;
    });

    expect(results).toEqual([10, 20, 30, 40, 50]);
  });

  it("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;

    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 3, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return null;
    });

    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1); // Confirms it is actually parallel.
  });

  it("passes the index to the mapper", async () => {
    const results = await mapWithConcurrency(["a", "b"], 2, async (item, i) =>
      `${i}:${item}`
    );
    expect(results).toEqual(["0:a", "1:b"]);
  });

  it("returns an empty array for empty input", async () => {
    await expect(mapWithConcurrency([], 5, async () => 1)).resolves.toEqual([]);
  });

  it("handles a limit larger than the item count", async () => {
    await expect(
      mapWithConcurrency([1, 2], 100, async (n) => n * 2)
    ).resolves.toEqual([2, 4]);
  });
});
