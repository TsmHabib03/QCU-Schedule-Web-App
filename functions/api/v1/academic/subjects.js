// GET /api/v1/academic/subjects — Public catalog: list all subjects
import { Subjects } from "../../repo/index.js";
import { json } from "../../auth/_lib.js";

export async function onRequestGet() {
  const active = Subjects.getActive();
  return json({ status: "OK", subjects: active, count: active.length });
}
