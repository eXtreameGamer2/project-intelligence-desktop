export function isCanceledError(error) {
  if (!error) return false;
  if (error.code === 'REQUEST_CANCELED' || error.name === 'AbortError' || error.code === 'ABORT_ERR') {
    return true;
  }
  const text = String(error.message || '').toLowerCase();
  return text.includes('the user aborted') || text.includes('this operation was aborted');
}

export function canceledError(message = 'Import canceled.') {
  const error = new Error(message);
  error.statusCode = 499;
  error.code = 'REQUEST_CANCELED';
  return error;
}

export function clientAbortSignal(req) {
  if (req._clientAbortController) return req._clientAbortController.signal;

  const controller = new AbortController();
  req._clientAbortController = controller;
  const res = req.res;

  const cancel = () => {
    if (!controller.signal.aborted) controller.abort();
  };

  // Do not use req.aborted/destroyed: after multer reads the file those are
  // often already true, which made every import cancel itself.
  res?.once('close', () => {
    if (!res.writableEnded) cancel();
  });

  return controller.signal;
}

export function throwIfCanceled(req) {
  if (req._clientAbortController?.signal.aborted) {
    throw canceledError();
  }
}
