/*
  LUMI-VEST publishing relay (Cloudflare Worker)

  Holds the GitHub token as a SECRET so it never reaches the browser. Realtors sign in on
  the website with their email + access code; this worker verifies both, then commits only
  to listings.json and img/listings/* in your repository.

  Secrets / variables (see README.md):
    GITHUB_TOKEN   fine-grained token, Contents: Read and write, this repo only  (secret)
    ADMIN_USERS    JSON map of allowed emails to access codes                    (secret)
                   e.g. {"jesevelarrealestate@gmail.com":"code-1","ada@example.com":"code-2"}
    GH_OWNER, GH_REPO, GH_BRANCH   where the site lives (plain variables)
    ALLOWED_ORIGIN your site, e.g. https://yourname.github.io  (optional, default *)
*/

const MAX_BODY = 40 * 1024 * 1024;
const MEDIA_RE = /^img\/listings\/[A-Za-z0-9._-]+\.(jpg|jpeg|png|webp|gif|mp4|webm|mov)$/;

const cors = (env) => ({
  "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, X-Admin-Email, X-Admin-Code",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
});

const json = (env, status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors(env) },
  });

async function digest(s) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}

// constant-time comparison (hash both sides so lengths match)
async function same(a, b) {
  const [x, y] = await Promise.all([digest(String(a)), digest(String(b))]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function authenticate(request, env) {
  const email = (request.headers.get("X-Admin-Email") || "").trim().toLowerCase();
  const code = request.headers.get("X-Admin-Code") || "";
  let users = {};
  try {
    users = JSON.parse(env.ADMIN_USERS || "{}");
  } catch {
    /* misconfigured -> nobody gets in */
  }
  const map = Object.fromEntries(
    Object.entries(users).map(([k, v]) => [k.trim().toLowerCase(), String(v)])
  );
  const expected = Object.prototype.hasOwnProperty.call(map, email) ? map[email] : null;
  const ok = (await same(code, expected ?? "\u0000no-user")) && expected !== null && code !== "";
  if (!ok) await new Promise((r) => setTimeout(r, 400)); // slow down guessing
  return ok ? email : null;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: cors(env) });

    const url = new URL(request.url);
    const email = await authenticate(request, env);
    if (!email) return json(env, 401, { message: "Wrong email or access code" });

    if (url.pathname === "/auth" && request.method === "POST")
      return json(env, 200, { ok: true });

    const m = /^\/contents(?:\/(.*))?$/.exec(url.pathname);
    if (!m) return json(env, 404, { message: "Not found" });
    const path = decodeURIComponent(m[1] || "").replace(/\/+$/, "");
    if (path.includes("..")) return json(env, 400, { message: "Bad path" });

    const api = `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/contents${path ? "/" + path.split("/").map(encodeURIComponent).join("/") : ""}`;
    const headers = {
      Accept: request.headers.get("Accept") || "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "User-Agent": "lumi-vest-admin",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const branch = env.GH_BRANCH || "main";

    if (request.method === "GET") {
      if (!["", "listings.json", "img/listings"].includes(path))
        return json(env, 403, { message: "Path not allowed" });
      const res = await fetch(`${api}?ref=${encodeURIComponent(branch)}`, { headers });
      return new Response(res.body, {
        status: res.status,
        headers: {
          "Content-Type": res.headers.get("Content-Type") || "application/json",
          ...cors(env),
        },
      });
    }

    if (request.method === "PUT") {
      if (path !== "listings.json" && !MEDIA_RE.test(path))
        return json(env, 403, { message: "Path not allowed" });
      if (Number(request.headers.get("Content-Length") || 0) > MAX_BODY)
        return json(env, 413, { message: "File too large" });
      let b;
      try {
        b = await request.json();
      } catch {
        return json(env, 400, { message: "Bad JSON" });
      }
      if (typeof b.content !== "string" || !b.content)
        return json(env, 400, { message: "Missing content" });
      const body = {
        message: `${String(b.message || "Update").slice(0, 120)} — by ${email}`,
        content: b.content,
        branch,
        ...(b.sha ? { sha: String(b.sha) } : {}),
      };
      const res = await fetch(api, {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return new Response(res.body, {
        status: res.status,
        headers: { "Content-Type": "application/json", ...cors(env) },
      });
    }

    return json(env, 405, { message: "Method not allowed" });
  },
};
