export const contentWidthClassName = Object.freeze({
  standard: "max-w-6xl",
  wide: "max-w-7xl",
  full: "max-w-none",
});

export function contentWidthClass(contentWidth) {
  return contentWidthClassName[contentWidth] || contentWidthClassName.standard;
}
