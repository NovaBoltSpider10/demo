function toSqlDateTime(val) {
  if (val === undefined || val === null || String(val).trim() === '') return null;
  const s = String(val).trim().replace('T', ' ');
  return s.length === 16 ? `${s}:00` : s;
}

function toNullableInt(val) {
  if (val === undefined || val === null || String(val).trim() === '') return null;
  const n = Number(val);
  return Number.isInteger(n) ? n : NaN;
}

function toNullableFloat(val) {
  if (val === undefined || val === null || String(val).trim() === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : NaN;
}

module.exports = {
  toSqlDateTime,
  toNullableInt,
  toNullableFloat
};