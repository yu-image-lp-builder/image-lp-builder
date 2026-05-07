# image-lp-builder

画像LPを誰でも簡単に公開できるOSS

The fastest way for non-engineers to publish an image-based landing
page on their own Cloudflare account — drop image sections, place
clickable CTAs over them, hit publish.

## Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/yu-labs/image-lp-builder)

One click. The button forks this repo into your GitHub, then
asks Cloudflare to:

- Provision a Worker, a D1 database, an R2 bucket, and a KV
  namespace on your account.
- Run `wrangler d1 migrations apply DB --remote` to create every
  table the admin UI needs (this is wired into the `deploy`
  script in `package.json`, which Cloudflare auto-detects).
- Deploy the Worker.

After the build finishes you get a `*.workers.dev` URL — open
`/admin` on it and you're in the builder. No SQL prompt to run,
no `wrangler` commands to type, no Cloudflare dashboard settings
to flip. To upgrade later, click **Re-deploy** on your Cloudflare
Workers dashboard whenever a new release is published.

## Stack

- Astro 6 + React 19 islands + Tailwind v4
- Cloudflare Workers (compute), D1 (database), R2 (image storage)
- Google OAuth for admin authentication

## Security considerations

### Open the admin promptly after deploy

The first Google account to sign in at `/admin` becomes the owner
of this Worker — that's how the Deploy button avoids asking you
for an email up front. Open `/admin` as soon as the build
finishes so you claim the owner slot before anyone else can. If
someone else races in, you can clear the `admin_users` table from
the Cloudflare D1 console and try again.

### Tracking scripts share the admin origin

The site-settings panel lets the admin paste arbitrary HTML into
the public LP `<head>` — typically GTM / GA4 / Meta Pixel / Clarity
snippets. Those scripts run on the same origin as the admin API,
so any script you paste effectively has the admin's session
authority while the admin is logged in.

- Only paste tracking snippets you control (your own GTM / Pixel
  containers — not third-party scripts you don't trust).
- Treat your GTM / Pixel accounts as part of the admin attack
  surface; harden them with 2FA / least-privilege.

## License

[GNU Affero General Public License v3.0](LICENSE) (AGPLv3).
