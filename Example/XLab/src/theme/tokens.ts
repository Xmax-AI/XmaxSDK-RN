/**
 * Shared colors for the XLab host screens.
 */
export const colors = {
  background: '#0C121B',
  surface: '#111C28',
  border: '#243844',
  primary: '#F4F7FB',
  secondary: '#8E9AA9',
  accent: '#8EF0C8',
  image: '#C9A3FF',
  external: '#FF9A45',
  trajectory: '#FF8FD8',
  storage: '#F5B86C',
} as const;

/** Uses the Feed base sizes without additional visual enlargement. */
export const feedFont = (size: number) => size;
