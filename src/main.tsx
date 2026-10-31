import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { runInterpreterVerificationSuite } from './game/engine/verificationSuite';

if (typeof window !== 'undefined') {
  (window as unknown as { runInterpreterVerificationSuite?: typeof runInterpreterVerificationSuite }).runInterpreterVerificationSuite =
    runInterpreterVerificationSuite;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

