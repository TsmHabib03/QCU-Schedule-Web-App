// GET /api/v1/academic/terms — Public catalog: list all academic terms
import { Terms } from "../../repo/index.js";
import { json } from "../../auth/_lib.js";

export async function onRequestGet() {
  const all = Terms.getAll();
  return json({ status: "OK", terms: all, count: all.length });
}
