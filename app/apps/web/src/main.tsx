import { createRoot } from 'react-dom/client';
import './lib/linkGuard.ts';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './styles/base.css';
import { App } from './App.tsx';

createRoot(document.getElementById('lit-app')!).render(<App />);
