/**
 * Types for the three `d3-geo-projection` factories this project uses.
 *
 * The package ships no declarations of its own and there is no `@types` package for
 * it, so the surface is declared here rather than reached through `any`. Only what is
 * actually imported is declared: adding a projection means adding its factory to this
 * file, which is the point — an undeclared name is a build error rather than a
 * runtime `undefined`, and that is exactly the failure mode to guard against when the
 * library exports both `geoHammer` and `geoNellHammer` and only one of them is the
 * projection being asked for.
 *
 * All three return an ordinary `GeoProjection`, built by d3-geo's own `geoProjection`
 * constructor, so `rotate`, `scale`, `translate`, `fitExtent` and `geoPath` behave
 * exactly as they do for the built-in projections.
 */
declare module 'd3-geo-projection' {
  import type { GeoProjection } from 'd3-geo'
  import type { GeoGeometryObjects } from 'd3-geo'

  /**
   * A geometry re-expressed in the projection's plane.
   *
   * The projection applied as a *coordinate transform* rather than as a renderer:
   * where `geoPath` turns geography into a path string, this turns it into ordinary
   * GeoJSON whose coordinates are projected x/y. Clipping and antimeridian cutting
   * happen exactly as they do when drawing, so what comes back matches the shape on
   * screen — which is the point, since it is measured against the drawn map.
   *
   * Null when the object is clipped away entirely.
   */
  export function geoProject<T extends GeoGeometryObjects>(
    object: T,
    projection: GeoProjection,
  ): T | null

  /**
   * Nell–Hammer, a pseudocylindrical projection.
   *
   * `x = λ(1 + cos φ)/2`, `y = 2(φ − tan(φ/2))`. Distinct from `geoHammer`, which is
   * an unrelated projection derived from azimuthal equal-area.
   */
  export function geoNellHammer(): GeoProjection

  /**
   * Winkel Tripel — the arithmetic mean of the Aitoff projection and an
   * equirectangular with standard parallel arccos(2/π), which is Winkel's 1921
   * definition. `geoWinkel3` is the library's name for it.
   */
  export function geoWinkel3(): GeoProjection

  /**
   * Robinson, from the author's published table of X/Y coefficients at 5° intervals,
   * interpolated quadratically between rows.
   */
  export function geoRobinson(): GeoProjection
}
