// CXB Ready Release Roadmap — live sync endpoint (Netlify Function + Netlify Blobs)
// GET  /.netlify/functions/roadmap?ping=1          -> {ok:true}
// GET  /.netlify/functions/roadmap?room=CXB-XXXX   -> {state, empty}
// POST /.netlify/functions/roadmap {room, patch}   -> merges patch (newest updatedAt wins) -> {state}
import { getStore } from "@netlify/blobs";

const ROOM = /^[A-Z0-9][A-Z0-9-]{4,40}$/;
const MAX_BODY = 600 * 1024;
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const blank = () => ({ settings: { updatedAt: 0 }, tasks: {}, custom: {}, plans: {}, activity: [] });
const newer = (a, b) => ((b && b.updatedAt) || 0) > ((a && a.updatedAt) || 0);

function merge(cur, patch) {
  if (patch.settings && typeof patch.settings === "object" && newer(cur.settings, patch.settings)) cur.settings = { ...cur.settings, ...patch.settings };
  for (const k of ["tasks", "custom", "plans"]) {
    if (!patch[k] || typeof patch[k] !== "object") continue;
    for (const id in patch[k]) if (newer(cur[k][id], patch[k][id])) cur[k][id] = patch[k][id];
  }
  if (Array.isArray(patch.activity)) {
    const seen = new Set(cur.activity.map(a => a.t + "|" + a.by + "|" + a.text));
    for (const a of patch.activity) {
      if (!a || typeof a.t !== "number") continue;
      const key = a.t + "|" + a.by + "|" + a.text;
      if (!seen.has(key)) { cur.activity.push({ t: a.t, by: String(a.by || "").slice(0, 40), text: String(a.text || "").slice(0, 200) }); seen.add(key); }
    }
    cur.activity.sort((x, y) => y.t - x.t);
    cur.activity = cur.activity.slice(0, 40);
  }
  return cur;
}

export default async (req) => {
  const url = new URL(req.url);
  const store = getStore("cxb-roadmap");

  if (req.method === "GET") {
    if (url.searchParams.get("ping")) return json({ ok: true });
    const room = String(url.searchParams.get("room") || "").toUpperCase();
    if (!ROOM.test(room)) return json({ error: "bad room" }, 400);
    const state = await store.get(room, { type: "json" });
    return json({ state: state || null, empty: !state });
  }

  if (req.method === "POST") {
    const len = Number(req.headers.get("content-length") || 0);
    if (len > MAX_BODY) return json({ error: "too large" }, 413);
    let body; try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
    const room = String(body.room || "").toUpperCase();
    if (!ROOM.test(room)) return json({ error: "bad room" }, 400);
    const cur = { ...blank(), ...((await store.get(room, { type: "json" })) || {}) };
    if (!cur.tasks) cur.tasks = {}; if (!cur.custom) cur.custom = {}; if (!cur.plans) cur.plans = {}; if (!cur.activity) cur.activity = [];
    const next = merge(cur, body.patch || {});
    await store.setJSON(room, next);
    return json({ state: next });
  }

  return json({ error: "method" }, 405);
};
