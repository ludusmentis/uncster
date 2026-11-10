import type { ReactNode } from 'react';

/**
 * Page content container (M003 / S03-2, T1): one shared max-width shell
 * with consistent vertical rhythm for every route. Consumes the existing
 * .container token class; pages render their content inside it so chrome
 * stays identical across routes (T2 wires this into App).
 */
export default function PageShell({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  return <div className="container page-shell">{children}</div>;
}
