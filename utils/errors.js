function badRequest(msg) {
  const err = new Error(msg);
  err.statusCode = 400;
  return err;
}

function notFound(msg = 'Record not found.') {
  const err = new Error(msg);
  err.statusCode = 404;
  return err;
}

module.exports = { badRequest, notFound };