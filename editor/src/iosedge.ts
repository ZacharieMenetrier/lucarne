// iPadOS 26+ blurs the top of a Home Screen app unless a fixed element with a solid
// background sits at the top edge (#ios-edge, in index.html). WebKit caches that edge and
// does not always look again: after a modal dialog (top layer, above any z-index) or a page
// switch, after rotating or coming back to the app, the blur could stay until a relaunch.
// Changing the band's height makes WebKit sample the edge again, so it changes for two frames
// whenever any of those happen.

export function keepIOSEdge() {
  const edge = document.getElementById('ios-edge')
  if (!edge || getComputedStyle(edge).display === 'none') return
  let pending = 0
  const resample = () => {
    if (pending) return
    edge.dataset.resample = ''
    pending = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        delete edge.dataset.resample
        pending = 0
      }),
    )
  }
  // A dialog added, opened or closed (dialogs are appended to body), a page shown or hidden.
  new MutationObserver(resample).observe(document.body, { childList: true })
  new MutationObserver(resample).observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ['open', 'data-page'],
  })
  document.addEventListener('close', resample, true)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) resample()
  })
  window.addEventListener('pageshow', resample)
  window.addEventListener('focus', resample)
  window.addEventListener('resize', resample)
}
