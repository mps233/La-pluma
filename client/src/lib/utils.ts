export type ClassValue = string | number | null | undefined | false;

/** Minimal shadcn-compatible class name joiner. */
export function cn(...classes: ClassValue[]) {
  return classes.filter(Boolean).join(" ");
}
