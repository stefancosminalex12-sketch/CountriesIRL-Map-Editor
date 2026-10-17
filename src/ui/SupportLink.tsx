/**
 * Support us: CountriesIRL's Ko-fi page, in the header just before Undo and Redo.
 *
 * The website's own button, copied: a rust outline pill with a heart, filled on hover. A plain
 * link opening in a new tab, so nothing about the map is touched and the Content-Security-Policy
 * needs nothing new. On a phone it is the heart alone, as on the website.
 */
const SUPPORT_URL = 'https://ko-fi.com/L1Y628Z7U0'

export function SupportLink() {
  return (
    <a className="support-link" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer" title="Support CountriesIRL on Ko-fi">
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
        <path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.1 5.3 3 1.7-1.9 3.2-3 5.3-3 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z" />
      </svg>
      <span className="support-link__label">Support us</span>
    </a>
  )
}
