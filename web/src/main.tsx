import React from 'react';
import { createRoot } from 'react-dom/client';
import { PublicPage } from './PublicPage';
import { AdminPage } from './AdminPage';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{window.location.pathname.startsWith('/admin') ? <AdminPage /> : <PublicPage />}</React.StrictMode>
);
