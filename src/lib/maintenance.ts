/**
 * Maintenance-mode HTML helper.
 *
 * Returned in place of any public LP while site_settings.maintenance_mode
 * is on. Embedded as a string (not an .astro component) so the public
 * routes can short-circuit without dragging the rest of their frontmatter
 * into a maintenance branch.
 */

const MAINTENANCE_HTML = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>メンテナンス中</title>
  <meta name="robots" content="noindex" />
  <style>
    body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem 1rem;background:#f5f7fa;color:#1f2937;font-family:-apple-system,BlinkMacSystemFont,'Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif;text-align:center;line-height:1.7}
    main{max-width:480px}
    h1{font-size:1.25rem;margin:0 0 .75rem;font-weight:600}
    p{margin:0;color:#4b5563;font-size:.9375rem}
    .icon{font-size:2rem;margin-bottom:1rem}
  </style>
</head>
<body>
  <main>
    <div class="icon">🛠️</div>
    <h1>メンテナンス中です</h1>
    <p>ただいまサイトの調整作業を行っています。<br />しばらく時間をおいてから再度アクセスしてください。</p>
  </main>
</body>
</html>`;

/**
 * Build a 200-OK response containing the maintenance page. Status is
 * 200 (not 503) so search engines can re-crawl freely after maintenance
 * ends; the page itself carries a `noindex` directive.
 */
export function maintenanceResponse(): Response {
  return new Response(MAINTENANCE_HTML, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
