import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../ui/theme.css';
import './welcome.css';
import { initContent } from '../content/main';
import { Welcome } from './Welcome';

// Lets the practice paragraph on this page behave exactly like a normal web page.
initContent();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Welcome />
  </StrictMode>
);
