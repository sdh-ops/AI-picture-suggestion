import { ANTHROPIC_KEY, TTB_KEY, MODEL } from "../server/lib.mjs";
import { sendJson } from "./_util.mjs";

export default async function handler(_req, res) {
  sendJson(res, 200, { ok: true, anthropic: !!ANTHROPIC_KEY, aladin: !!TTB_KEY, model: MODEL });
}
