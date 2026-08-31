// GET /api/v1/academic/departments — Public catalog: list all departments
import { Departments } from "../../repo/index.js";
import { json } from "../../auth/_lib.js";

export async function onRequestGet() {
  const active = Departments.getActive();
  return json({ status: "OK", departments: active, count: active.length });
}
