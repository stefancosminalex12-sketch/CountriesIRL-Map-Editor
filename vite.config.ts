import { createHash } from 'node:crypto'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The security policy of the published page, as a <meta> tag: GitHub Pages serves no headers of
 * our own, and a Content-Security-Policy is the one that can be given this way.
 *
 * The editor loads nothing from anywhere else — every map, flag and sticker is on this site — so
 * scripts, data and fonts come from here only, and nothing may run that the build did not ship.
 * The one inline script (the splash's theme, in index.html) is allowed by its hash, taken from the
 * finished page, so editing it can never leave the policy behind. Pictures may also be `data:` and
 * `blob:` URLs: the stickers people add and the maps they export are both.
 *
 * Build only: the development server runs inline scripts of its own (hot reload).
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/g)].map(
          ([, body]) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`,
        )
        const policy = [
          "default-src 'self'",
          `script-src 'self' ${hashes.join(' ')}`.trim(),
          // Inline style attributes: the splash in index.html, and the styles React sets.
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:",
          "connect-src 'self' data: blob:",
          "font-src 'self' data:",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'none'",
          'upgrade-insecure-requests',
        ].join('; ')
        return html.replace(
          '<meta charset="UTF-8" />',
          `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />\n    <meta name="referrer" content="strict-origin-when-cross-origin" />`,
        )
      },
    },
  }
}

export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
  // 5173 unless the environment asks for another port, so this can run alongside
  // another dev server without either of them having to move.
  server: { port: Number(process.env.PORT) || 5173, open: false },
})
