import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const App = lazy(() => import('./editor/App').then(module => ({ default: module.App })));
const CaseStudy = lazy(() => import('./portfolio/CaseStudy').then(module => ({ default: module.CaseStudy })));
const caseStudy = location.pathname === '/case-study';

createRoot(document.getElementById('root')!).render(
  <Suspense fallback={<main className="loading-screen" aria-busy="true"><p role="status">Opening Debotaro Studio…</p></main>}>
    {caseStudy ? <CaseStudy screenshotUrl="/screenshots/editor-desktop.png" /> : <App />}
  </Suspense>,
);
