// GET /api/v1/academic/rooms — Public catalog: list all rooms
import { CatalogRooms } from "../../repo/index.js";
import { json } from "../../auth/_lib.js";

export async function onRequestGet() {
  const active = CatalogRooms.getActive();
  return json({ status: "OK", rooms: active, count: active.length });
}
