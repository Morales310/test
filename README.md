# LUMI-VEST publishing relay — 5-minute setup

1. Install once: `npm i -g wrangler` then `wrangler login` (free Cloudflare account).
2. Edit `wrangler.toml`: set GH_OWNER, GH_REPO, GH_BRANCH (and ALLOWED_ORIGIN = your site URL).
3. Create a GitHub fine-grained token: only your repo, Permissions -> Contents: Read and write.
4. From this folder:
   - `wrangler secret put GITHUB_TOKEN`   (paste the token)
   - `wrangler secret put ADMIN_USERS`    (paste e.g. {"you@gmail.com":"a-long-code","ada@example.com":"another-code"})
   - `wrangler deploy`                    (prints https://lumi-vest-admin.<you>.workers.dev)
5. In script.js set `const ADMIN_API = "https://lumi-vest-admin.<you>.workers.dev";` and redeploy the site.

Add/remove a realtor: re-run `wrangler secret put ADMIN_USERS` with the updated JSON.
Give each realtor their own code; commit messages show who published.
