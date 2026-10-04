// Suppress known Firestore backend connection retry spam when Firestore database is not yet provisioned in Firebase Console
if (typeof window !== 'undefined') {
  const filterFirestoreLog = (orig: (...args: any[]) => void) => (...args: any[]) => {
    const text = args.map(a => typeof a === 'object' ? (a?.message || JSON.stringify(a)) : String(a)).join(' ');
    if (
      text.includes('@firebase/firestore') && 
      (text.includes('NOT_FOUND') || text.includes('Listen') || text.includes('Could not reach Cloud Firestore backend') || text.includes('GrpcConnection'))
    ) {
      return;
    }
    orig.apply(console, args);
  };
  console.warn = filterFirestoreLog(console.warn);
  console.error = filterFirestoreLog(console.error);
}

import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
