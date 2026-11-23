/**
 * Official brand assets, cropped (never redrawn) from the owner's logo file:
 * brand-source/picklehouse-logo-original.png — deep green background, white
 * wordmark and roof, lime pickleball, "dine, drink, enjoy".
 *
 * Until that file is committed these are `null`, and the logo components show
 * the venue name as plain text instead. Never substitute a recreated logo.
 */

export interface BrandImage {
  src: string
  width: number
  height: number
  alt: string
}

export const brandAssets: {
  /** Full lockup: "Boss Dodong", "picklehouse" with roof and ball, tagline. On deep green. */
  logo: BrandImage | null
  /** The lime ball under the roof, cropped from the lockup, for small sizes. */
  emblem: BrandImage | null
} = {
  logo: null,
  emblem: null,
}
