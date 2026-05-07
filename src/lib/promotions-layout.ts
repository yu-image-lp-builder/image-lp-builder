/**
 * Layout helpers for the conversion-boost elements (countdown,
 * scarcity, floating CTA).
 *
 * Both the root `/` and the slug routes need the same logic to:
 *   - decide which bars are actually rendered
 *   - stack them when they share an edge
 *   - report the combined sticky height to PublicLayout
 *
 * This module owns that math so the two pages can stay short.
 */

import type { Promotions } from './content';

// Approximate fixed-bar heights. Countdown is taller because it
// renders label + monospace timer; scarcity is one short line.
export const COUNTDOWN_BAR_HEIGHT = 44;
export const SCARCITY_BAR_HEIGHT = 40;

export type PromotionsLayout = {
  showCountdown: boolean;
  showScarcity: boolean;
  showFloatingCta: boolean;
  /** Pixel offset for the scarcity bar from the edge it pins to. */
  scarcityOffset: number;
  /** Body padding to forward to PublicLayout. */
  stickyTopHeight: number;
  stickyBottomHeight: number;
};

export function computePromotionsLayout(
  promotions: Promotions | undefined
): PromotionsLayout {
  const countdown = promotions?.countdown;
  const scarcity = promotions?.scarcity;
  const floatingCta = promotions?.floatingCta;

  const showCountdown =
    !!countdown &&
    countdown.enabled &&
    !!countdown.deadline &&
    // Past-deadline AND no expired-message ⇒ hide the bar entirely.
    (new Date(countdown.deadline).getTime() > Date.now() ||
      !!countdown.expiredText);

  const showScarcity = !!scarcity && scarcity.enabled && !!scarcity.text.trim();

  const showFloatingCta =
    !!floatingCta && floatingCta.enabled && !!floatingCta.text.trim();

  // When countdown shares an edge with scarcity, scarcity sits inside.
  const countdownTopOffset =
    showCountdown && countdown && countdown.position === 'top'
      ? COUNTDOWN_BAR_HEIGHT
      : 0;
  const countdownBottomOffset =
    showCountdown && countdown && countdown.position === 'bottom'
      ? COUNTDOWN_BAR_HEIGHT
      : 0;

  const scarcityOffset =
    showScarcity && scarcity
      ? scarcity.position === 'top'
        ? countdownTopOffset
        : countdownBottomOffset
      : 0;

  const stickyTopHeight =
    countdownTopOffset +
    (showScarcity && scarcity && scarcity.position === 'top'
      ? SCARCITY_BAR_HEIGHT
      : 0);
  const stickyBottomHeight =
    countdownBottomOffset +
    (showScarcity && scarcity && scarcity.position === 'bottom'
      ? SCARCITY_BAR_HEIGHT
      : 0);

  return {
    showCountdown,
    showScarcity,
    showFloatingCta,
    scarcityOffset,
    stickyTopHeight,
    stickyBottomHeight,
  };
}
