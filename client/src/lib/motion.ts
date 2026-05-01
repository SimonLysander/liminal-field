/**
 * Shared easing curves used throughout the app.
 *
 * - appleEase: Standard Apple-style deceleration for general transitions.
 * - smoothBounce: Overshooting ease for elements that should feel springy
 *   (page transitions, slide animations).
 *
 * Typed as `const` tuples so Motion accepts them as cubic-bezier values.
 */
export const appleEase = [0.25, 0.1, 0.25, 1] as const;
export const smoothBounce = [0.16, 1, 0.3, 1] as const;
