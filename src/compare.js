import { mean, median } from "./stats.js";

/**
 * For each sale, find comparable rentals (by bedroom match with fallbacks), then
 * compare list price to comp rent distribution (median/mean yield).
 *
 * @param {Array<{ zpid: number, price: number, bedrooms: number | null, homeType: string | null, address?: string | null, streetAddress?: string | null, sqft?: number | null, photoUrl?: string | null }>} sales
 * @param {Array<{ zpid: number, price: number, bedrooms: number | null, homeType: string | null, address?: string | null, streetAddress?: string | null, sqft?: number | null, photoUrl?: string | null }>} rentals
 * @param {{ minComps?: number, preferType?: boolean }} [options]
 */
export function compareSalesToRentComps(sales, rentals, options = {}) {
  const minComps = options.minComps ?? 3;
  const preferType = Boolean(options.preferType);
  const currentYear = new Date().getFullYear();

  const rentPool = rentals.filter((r) => typeof r.price === "number" && r.price > 0);
  const saleRows = sales.filter((s) => typeof s.price === "number" && s.price > 0);

  return saleRows.map((sale) => {
    let comps = rentPool;

    if (preferType && sale.homeType) {
      const token = String(sale.homeType).toLowerCase().split(/[\s/-]/)[0];
      if (token) {
        const narrowed = comps.filter(
          (r) =>
            r.homeType &&
            String(r.homeType).toLowerCase().includes(token)
        );
        if (narrowed.length >= minComps) comps = narrowed;
      }
    }

    let matchTier = "all_rentals_in_region";

    if (sale.bedrooms != null && Number.isFinite(sale.bedrooms)) {
      const exact = comps.filter((r) => r.bedrooms === sale.bedrooms);
      if (exact.length >= minComps) {
        comps = exact;
        matchTier = "exact_bedrooms";
      } else {
        const pm1 = comps.filter(
          (r) =>
            r.bedrooms != null &&
            Math.abs(r.bedrooms - sale.bedrooms) <= 1
        );
        if (pm1.length >= minComps) {
          comps = pm1;
          matchTier = "bedrooms_plus_minus_1";
        } else if (exact.length > 0) {
          comps = exact;
          matchTier = "exact_bedrooms_sparse";
        } else if (pm1.length > 0) {
          comps = pm1;
          matchTier = "bedrooms_plus_minus_1_sparse";
        } else {
          matchTier = "no_rental_bedroom_overlap";
        }
      }
    }

    const rentPrices = comps.map((c) => c.price).filter((n) => n > 0);
    const medRent = median(rentPrices);
    const meanRent = mean(rentPrices);
    const grossYieldMedian =
      medRent != null && sale.price > 0
        ? ((medRent * 12) / sale.price) * 100
        : null;
    const grossYieldMean =
      meanRent != null && sale.price > 0
        ? ((meanRent * 12) / sale.price) * 100
        : null;

    const sorted = [...rentPrices].sort((a, b) => a - b);
    const minR = sorted[0] ?? null;
    const maxR = sorted[sorted.length - 1] ?? null;

    const street =
      (sale.streetAddress && String(sale.streetAddress).trim()) ||
      (sale.address ? sale.address.split(",")[0]?.trim() : null) ||
      null;

    return {
      saleZpid: sale.zpid,
      saleAddress: sale.address ?? null,
      saleStreet: street,
      salePhotoUrl: sale.photoUrl ?? null,
      salePrice: sale.price,
      saleBeds: sale.bedrooms,
      saleSqft: sale.sqft ?? null,
      saleYearBuilt: sale.yearBuilt ?? null,
      saleAge:
        sale.yearBuilt != null && Number.isFinite(sale.yearBuilt)
          ? Math.max(0, currentYear - sale.yearBuilt)
          : null,
      saleType: sale.homeType,
      compCount: rentPrices.length,
      matchTier,
      compRentMedian: medRent,
      compRentMean: meanRent,
      compRentMin: minR,
      compRentMax: maxR,
      grossYieldMedianPercent: grossYieldMedian,
      grossYieldMeanPercent: grossYieldMean,
    };
  });
}
