export const ok = (res, data, message = "OK", status = 200) => {
  return res.status(status).json({ success: true, message, data });
};

export const created = (res, data, message = "Created") => {
  return ok(res, data, message, 201);
};

export const noContent = (res) => {
  return res.status(204).send();
};
