/**
 * Number and label formatting shared by every component.
 *
 * One rule runs through all of it: a value that is null is not a zero. Null
 * means the figure cannot be answered at the current grain -- EBITDA under a
 * customer filter, market share below category level -- and it renders as a
 * dash, never as a number. Passing null into a formatter and getting "0.0m"
 * back would be the whole point of the logic layer thrown away at the last
 * step.
 */

export const NOT_AVAILABLE = "n/a";

const million = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const millionSigned = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});
const whole = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const oneDp = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const oneDpSigned = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});
const twoDp = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Millions, one decimal. `1.234m` */
export function money(value, { signed = false } = {}) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return NOT_AVAILABLE;
  }
  const fmt = signed ? millionSigned : million;
  return `${fmt.format(value / 1e6)}m`;
}

/** A fraction as a percentage. `0.409` becomes `40.9%` */
export function percent(value, { signed = false } = {}) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return NOT_AVAILABLE;
  }
  const fmt = signed ? oneDpSigned : oneDp;
  return `${fmt.format(value * 100)}%`;
}

/** A difference between two ratios, in points. `0.016` becomes `+1.6pp` */
export function points(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return NOT_AVAILABLE;
  }
  return `${oneDpSigned.format(value * 100)}pp`;
}

/** Cases, in millions when large enough to need it. */
export function cases(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return NOT_AVAILABLE;
  }
  if (Math.abs(value) >= 1e6) return `${oneDp.format(value / 1e6)}m`;
  return whole.format(value);
}

/** A plain ratio, such as promotional return. `0.82` */
export function times(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return NOT_AVAILABLE;
  }
  return twoDp.format(value);
}

/** Currency per case. `18.67` */
export function perCase(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return NOT_AVAILABLE;
  }
  return twoDp.format(value);
}

/**
 * The class name that colours a variance.
 *
 * Driven by the `favourable` flag the logic layer already derived from the
 * line's sign, never by whether the number happens to be positive: a cost
 * coming in above plan is a bigger number and worse news.
 */
export function varianceClass(favourable) {
  if (favourable === null || favourable === undefined) return "is-flat";
  return favourable ? "is-favourable" : "is-adverse";
}

/** Read a CSS custom property, so colour stays defined in one place. */
export function cssVar(name) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

/** The period label shown in the header, e.g. "Jan-Aug 2026". */
export function periodLabel(dataset, months) {
  if (!months.length) return "";
  const year = dataset.meta.current_year;
  const first = dataset.meta.months[months[0] - 1].short;
  if (months.length === 1) return `${first} ${year}`;
  const last = dataset.meta.months[months[months.length - 1] - 1].short;
  return `${first}-${last} ${year}`;
}
