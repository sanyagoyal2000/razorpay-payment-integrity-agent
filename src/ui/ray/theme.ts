import { bladeTheme } from "@razorpay/blade/tokens";

const light = bladeTheme.colors.onLight.surface;

/**
 * RAY semantic tokens. RAY green identifies AI-assisted content only; it never
 * means success, approval or safety (use Blade feedback colours for those).
 *
 * Every value maps to a Blade token except `borderSubtle`, which Blade does
 * not provide: it is a prototype approximation, not an official Razorpay
 * brand value. Exact RAY brand colours are not published and are not claimed.
 */
export const RAY = {
  /** Mint identity for text on light surfaces (Blade surface.text.onSea.onSubtle). */
  accent: "surface.text.onSea.onSubtle",
  /** Icon identity on light surfaces (Blade surface.icon.onSea.onSubtle). */
  accentIcon: "surface.icon.onSea.onSubtle",
  /**
   * Mint identity on the black top navigation. Blade's TopNav renders its
   * children in the dark colour scheme, where the same onSubtle tokens resolve
   * to light mint (text hsla(150, 59%, 82%)), so the token names match the
   * light-surface ones.
   */
  accentOnDark: "surface.text.onSea.onSubtle",
  accentIconOnDark: "surface.icon.onSea.onSubtle",
  /** Quieter text beside the identity (Blade surface.text.gray.muted). */
  accentMuted: "surface.text.gray.muted",
  /** Very pale green-tinted surface (Blade surface.background.sea.subtle). */
  surfaceSubtle: "surface.background.sea.subtle",
} as const;

/** Raw values for the few styles Blade props cannot express (gradients, custom borders). */
export const RAY_VALUES = {
  surfaceSubtle: light.background.sea.subtle,
  /** Prototype approximation: low-contrast mint border. */
  borderSubtle: "hsla(155, 45%, 45%, 0.28)",
  /** Static ambient wash from Blade sea.subtle to cloud.subtle. */
  glowStart: light.background.sea.subtle,
  glowEnd: light.background.cloud.subtle,
  accent: light.text.onSea.onSubtle,
  accentIcon: light.icon.onSea.onSubtle,
} as const;
