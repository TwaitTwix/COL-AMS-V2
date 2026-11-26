export function validate(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const error = new Error("Invalid request input");
    error.status = 400;
    error.details = result.error.issues.map(({ path, message }) => ({ path, message }));
    throw error;
  }
  return result.data;
}
