import { useEffect, useState } from 'react';
import Home from './pages/Home';
import Callback from './pages/Callback';
import PlaylistTracks from './pages/PlaylistTracks';
import { parseRoute, subscribeRoute } from './routing';

/**
 * Minimal pushState-aware routing (no router dependency). subscribeRoute
 * keeps the current path in state so navigate()/popstate re-render; the
 * route itself is resolved by the pure parseRoute helper.
 */
export default function App(): JSX.Element {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const unsubscribe = subscribeRoute((next) => setPath(next));
    return unsubscribe;
  }, []);

  const route = parseRoute(path);

  switch (route.name) {
    case 'callback':
      return <Callback />;
    case 'playlist':
      return <PlaylistTracks id={route.id} />;
    default:
      return <Home />;
  }
}
