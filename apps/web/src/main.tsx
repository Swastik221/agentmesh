import React from 'react';
import ReactDOM from 'react-dom/client';
import { DemoRouter } from './demo/DemoRouter';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DemoRouter />
  </React.StrictMode>,
);
