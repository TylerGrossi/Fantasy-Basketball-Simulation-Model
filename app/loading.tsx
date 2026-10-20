/**
 * What a page shows while its server render is still running.
 *
 * Every page is rendered per request (the team cookie makes them dynamic). With no
 * loading boundary, Next keeps the OLD page on screen until the new one is completely
 * done — so a click on a menu item looked like nothing happened for a beat. With this
 * file, Next prefetches the layout up to here and swaps it in the moment a link is
 * clicked: the header's current item moves straight away and this outline holds the
 * space until the real page streams in.
 *
 * It fades in after a short delay (`.page-loading` in globals.css), so a page that renders
 * quickly goes straight to its content without a skeleton flashing up first.
 */
export default function Loading() {
  return (
    <div className="page-loading" role="status" aria-label="Loading">
      <div className="pl-title" />
      <div className="pl-tiles">
        <div />
        <div />
        <div />
        <div />
      </div>
      <div className="pl-table">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} />
        ))}
      </div>
    </div>
  );
}
