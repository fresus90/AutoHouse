import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { App } from './App';
import { isDemoMode } from './lib/api';
import './styles.css';

// Der Demo-Build laeuft als einzelne HTML-Datei ohne Server, der Pfade
// aufloesen koennte – dort uebernimmt der Hash-Router.
const Router = isDemoMode ? HashRouter : BrowserRouter;

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Router>
      <App />
    </Router>
  </React.StrictMode>,
);
