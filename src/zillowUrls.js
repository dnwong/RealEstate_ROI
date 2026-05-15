function slugCity(city) {
  return city
    .trim()
    .toLowerCase()
    .replace(/['.]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

/**
 * @param {{ listingType: "sale" | "rent"; zip?: string; city?: string; state?: string }} q
 */
export function buildZillowSearchUrl(q) {
  const path = q.listingType === "rent" ? "for_rent" : "for_sale";
  if (q.zip) {
    const z = String(q.zip).replace(/\D/g, "").slice(0, 5);
    if (z.length !== 5) throw new Error("ZIP must be 5 digits");
    return `https://www.zillow.com/homes/${path}/${z}_rb/`;
  }
  if (q.city && q.state) {
    const st = String(q.state).trim().toLowerCase();
    if (st.length !== 2) throw new Error("State must be a 2-letter code");
    const slug = `${slugCity(q.city)}-${st}`;
    return `https://www.zillow.com/homes/${path}/${slug}_rb/`;
  }
  throw new Error("Provide zip or city+state");
}
