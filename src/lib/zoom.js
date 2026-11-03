// The UI scale setting zooms the root element, which leaves getBoundingClientRect in
// screen pixels while fixed positions are in zoomed ones. Popovers divide by this.
export const uiZoom = () => parseFloat(document.documentElement.style.zoom) || 1;
