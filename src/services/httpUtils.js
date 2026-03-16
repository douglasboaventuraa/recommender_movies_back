export const parsePage = (value) => Math.max(1, Number.parseInt(value, 10) || 1);

export const parseLimit = (value, { min = 1, max = 100, defaultValue = 20 } = {}) => {
  const parsed = Number.parseInt(value, 10) || defaultValue;
  return Math.min(max, Math.max(min, parsed));
};

export const toOffset = (page, limit) => (page - 1) * limit;
