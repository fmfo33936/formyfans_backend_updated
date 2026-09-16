const variantKey = (size, colour) =>
  `${String(size).trim().toLowerCase()}\0${String(colour).trim().toLowerCase()}`;

/**
 * Normalize size/colour from a string, array, or omitted value to a unique string array.
 */
const toVariantArray = (value) => {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    return [...new Set(value.map((x) => String(x).trim()).filter(Boolean))];
  }
  const single = String(value).trim();
  return single ? [single] : [];
};

const variantArraysMatch = (a, b) => {
  const left = toVariantArray(a).sort().join("\0");
  const right = toVariantArray(b).sort().join("\0");
  return left === right;
};

/** Query param: "S,M,L" or JSON array string */
const parseQueryVariantArray = (queryValue) => {
  if (queryValue === undefined || queryValue === null || queryValue === "") return [];
  if (Array.isArray(queryValue)) return toVariantArray(queryValue);
  const raw = String(queryValue).trim();
  if (raw.startsWith("[")) {
    try {
      return toVariantArray(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  return toVariantArray(raw.split(","));
};

module.exports = {
  variantKey,
  toVariantArray,
  variantArraysMatch,
  parseQueryVariantArray,
};
