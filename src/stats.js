export function mean(nums) {
  const a = nums.filter((n) => Number.isFinite(n));
  if (!a.length) return null;
  return a.reduce((s, n) => s + n, 0) / a.length;
}

export function median(nums) {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * @param {Array<{ price?: number, bedrooms?: number }>} listings
 * @param {(n: number) => boolean} [priceOk]
 */
export function summarizePrices(listings, priceOk = (n) => n > 0) {
  const prices = listings
    .map((l) => l.price)
    .filter((p) => typeof p === "number" && priceOk(p));
  return {
    count: prices.length,
    mean: mean(prices),
    median: median(prices),
  };
}
