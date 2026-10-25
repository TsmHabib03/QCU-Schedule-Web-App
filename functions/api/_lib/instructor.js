// A per-class override: null inherits the COR professor; empty clears it.
export function validInstructorName(value) {
  return value === undefined || value === null ||
    (typeof value === 'string' && value.trim().length <= 120);
}

export function normalizeInstructorName(value) {
  return value == null ? null : value.trim();
}
