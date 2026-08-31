// GET /api/v1/academic/programs — Public catalog: list all programs
import { Programs } from "../../repo/index.js";
import { json } from "../../auth/_lib.js";

export async function onRequestGet() {
  const active = Programs.getActive();
  return json({ status: "OK", programs: active, count: active.length });
}
