/**
 * Which flag a non-sovereign entity in this dataset flies, stated one entity at a
 * time.
 *
 * Natural Earth carries fifteen entities with no ISO country code, so nothing in the
 * artwork set matches them by code and they render as plain land. Some of them should
 * plainly carry a flag; others should plainly not. Guessing either way is wrong, so
 * every one of the fifteen is listed here with the reason, and the list is the whole
 * policy — the renderer adds no rule of its own.
 *
 * Keyed by the dataset's entity id, because that is the stable identifier; the value
 * is the artwork code, which is an ISO alpha-2 for a borrowed flag and the entity's
 * own iso2 for the two flags drawn in `assets/flags/`.
 */

/** Entities that fly a flag, and whose. */
export const TERRITORY_FLAGS = {
  // De facto states with their own flag, drawn in `assets/flags/`.
  XSO: 'xs', // Somaliland
  XNC: 'xn', // Northern Cyprus

  // Administered territory: the administering state's flag is the one actually flown.
  XAK: 'gb', // Akrotiri — UK Sovereign Base Area on Cyprus
  XDH: 'gb', // Dhekelia — UK Sovereign Base Area on Cyprus
  XGB: 'us', // Guantanamo Bay — US naval station under indefinite lease
  XCP: 'fr', // Clipperton Island — French state property
  XIO: 'au', // Indian Ocean Territories — Christmas Island and the Cocos Islands
  XCS: 'au', // Coral Sea Islands — Australian external territory
}

/**
 * Entities deliberately left with no flag, and why.
 *
 * Present so that "no flag" is a decision on the record rather than an oversight, and
 * so a later reader can see that the list was considered in full.
 */
export const TERRITORY_NO_FLAG = {
  XCB: 'Cyprus U.N. Buffer Zone — administered by a peacekeeping force, not a territory',
  XSI: 'Siachen Glacier — contested by India and Pakistan, neither in control throughout',
  XSP: 'Spratly Islands — claimed in part by six governments, occupied piecemeal',
  XSR: 'Scarborough Reef — contested, no settled administration',
  XBN: 'Bajo Nuevo Bank — uninhabited, competing claims',
  XSN: 'Serranilla Bank — uninhabited, competing claims',
  XBK: 'Baikonur — Kazakh territory leased to Russia; neither flag is the plain answer',
}
