// GET /api/v1/academic/buildings — Public catalog: list all campus buildings
import { CatalogBuildings } from "../../repo/index.js";
import { json } from "../../auth/_lib.js";

export async function onRequestGet() {
  const active = CatalogBuildings.getActive();
  return json({ status: "OK", buildings: active, count: active.length });
}
