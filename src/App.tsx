import Home from './pages/Home';
import Callback from './pages/Callback';

/**
 * Minimal path-based routing (no router dependency yet).
 * Vite dev server serves the SPA at / and /callback; unknown paths
 * fall back to Home, matching the two registered routes.
 */
export default function App(): JSX.Element {
  const path = window.location.pathname;

  if (path === '/callback') {
    return <Callback />;
  }

  return <Home />;
}
