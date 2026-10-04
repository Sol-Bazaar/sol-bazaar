/**
 * Cookie name for the order tracking token.
 *
 * Kept in its own module so both the checkout server action (which writes it) and
 * the route handler (which reads it) share one definition — a drift here would
 * silently break every tracking link.
 */
export const TRACKING_COOKIE = 'fc_track';