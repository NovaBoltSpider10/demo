function handleDbError(res, err) {
  if (err && err.statusCode) {
    console.warn(`[Client ${err.statusCode}] ${err.message}`);
    return res.status(err.statusCode).json({ error: err.message });
  }

  const code = err?.code;
  const sqlState = err?.sqlState;
  console.warn(`[DB Error] code=${code || 'N/A'} sqlState=${sqlState || 'N/A'} msg=${err?.sqlMessage || err?.message}`);

  if (sqlState === '45000') {
    return res.status(400).json({ error: err.sqlMessage || err.message });
  }
  if (code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: 'Duplicate record: a unique field (such as email or license plate) already exists.' });
  }
  if (code === 'ER_NO_REFERENCED_ROW_2') {
    return res.status(400).json({ error: 'Referenced ID does not exist (check Customer, Fleet Business, Tour Request, Driver, or Vehicle ID).' });
  }
  if (code === 'ER_ROW_IS_REFERENCED_2') {
    return res.status(409).json({ error: 'Cannot delete record because other records reference it (restricted by foreign key).' });
  }
  if (code === 'WARN_DATA_TRUNCATED' || code === 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD' || code === 'ER_CHECK_CONSTRAINT_VIOLATED') {
    return res.status(400).json({ error: err.sqlMessage || 'Invalid field value or constraint violation.' });
  }

  console.error('[Unexpected DB Error]', err);
  return res.status(500).json({ error: 'Internal database error.' });
}

module.exports = handleDbError;