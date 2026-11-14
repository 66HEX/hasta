import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';

import './styles.css';

try {
  const preference = localStorage.getItem('hasta.theme');
  document.documentElement.classList.toggle(
    'dark',
    preference === 'dark' ||
      (preference === null && matchMedia('(prefers-color-scheme: dark)').matches),
  );
} catch {
  document.documentElement.classList.toggle(
    'dark',
    matchMedia('(prefers-color-scheme: dark)').matches,
  );
}

const root = document.querySelector('#root');

if (!root) {
  throw new Error('Application root was not found.');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
