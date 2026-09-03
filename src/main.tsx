import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Router } from './lib/router';
import { configurado } from './lib/supabase';
import './styles.css';

import { Admin } from './screens/Admin';
import { Control } from './screens/Control';
import { ExportResults } from './screens/ExportResults';
import { Home } from './screens/Home';
import { Join } from './screens/Join';
import { Present } from './screens/Present';
import { Results } from './screens/Results';
import { Setup } from './screens/Setup';

const app = configurado ? (
  <Router
    fallback={<Home />}
    routes={[
      { path: '/', element: <Home /> },
      { path: '/admin', element: <Admin /> },
      { path: '/j', element: <Join /> },
      { path: '/j/:code', element: <Join /> },
      { path: '/p/:sessionId', element: <Present /> },
      { path: '/c/:sessionId', element: <Control /> },
      { path: '/r/:sessionId', element: <Results /> },
      { path: '/export/:sessionId', element: <ExportResults /> },
    ]}
  />
) : (
  <Setup />
);

createRoot(document.getElementById('root')!).render(<StrictMode>{app}</StrictMode>);
