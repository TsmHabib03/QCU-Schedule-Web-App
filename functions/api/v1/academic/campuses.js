// GET /api/v1/academic/campuses — Public catalog: list all QCU campuses
import { Campuses } from "../../repo/index.js";
import { json } from "../../auth/_lib.js";

export async function onRequestGet() {
  const active = Campuses.getActive();
  return json({ status: "OK", campuses: active, count: active.length });
}
