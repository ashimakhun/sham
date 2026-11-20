// ARU-159: the Privacy Policy and Terms of Use. One version number for both documents; raise it (and publish the new
// pages under legal/) when either changes: every account then sees "We've updated our Terms" once.
import type { Language } from '@/i18n';

/** The current version of both documents (1 = the first published texts). */
export const LEGAL_VERSION = 1;
/** The date the current version takes effect, as printed at the top of the pages. */
export const LEGAL_EFFECTIVE_DATE = '2026-11-20';
/** The operator's address for "Contact us". */
export const CONTACT_EMAIL = 'ashimakhun.a@gmail.com';
/** The subject of a "Contact us" email. */
export const CONTACT_SUBJECT = 'Sham';

/** The public pages (GitHub Pages from this repo's legal/ folder; README → Legal pages). */
const BASE = 'https://ashimakhun.github.io/sham/legal';
export const LEGAL_URLS = {
  privacy: { en: `${BASE}/privacy.html`, ru: `${BASE}/privacy-ru.html` },
  terms: { en: `${BASE}/terms.html`, ru: `${BASE}/terms-ru.html` },
} as const;

export type LegalDocument = keyof typeof LEGAL_URLS;

/** The page of a document in the app's language (not the phone's). */
export const legalUrl = (doc: LegalDocument, lang: Language): string => LEGAL_URLS[doc][lang];

/** mailto: address for "Contact us", with the subject. */
export const contactMailto = (): string => `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(CONTACT_SUBJECT)}`;

/** AC 8 / AC 10: the update screen shows when the latest agreement is older than the current version, or missing.
 *  `undefined` (not loaded yet, or the request failed) never blocks (edge case: offline at start). */
export const needsLegalAgreement = (latest: number | null | undefined): boolean =>
  latest !== undefined && (latest === null || latest < LEGAL_VERSION);
