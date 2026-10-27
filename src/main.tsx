import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { TestType } from './analysis/types';
import { SessionPage } from './ui/pages/SessionPage';
import { Summary } from './ui/pages/Summary';
import { TestPage } from './ui/pages/TestPage';
import { Validation } from './ui/pages/Validation';
import { useStore } from './ui/store';
import './ui/styles.css';

function useHash() {
  const [h, setH] = useState(location.hash || '#/');
  useEffect(() => {
    const f = () => setH(location.hash || '#/');
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return h;
}

function App() {
  const h = useHash();
  const s = useStore();
  const test = h.match(/^#\/test\/(CMJ|SJ|DJ)/)?.[1] as TestType | undefined;
  const count = (t: TestType) => s.trials.filter((x) => x.test === t && x.mode === 'official' && x.accepted !== false && x.result.status !== 'Fail').length;
  const link = (href: string, label: string, on: boolean) => <a key={href} href={href} className={on ? 'on' : ''}>{label}</a>;
  return (
    <>
      <header className="top">
        <div className="inner">
          <span className="brand">JumpLens<small>單機側拍跳躍分析</small></span>
          <nav>
            {link('#/', '受試者', h === '#/')}
            {(['CMJ', 'SJ', 'DJ'] as TestType[]).map((t) => link(`#/test/${t}`, `${t} (${count(t)})`, test === t))}
            {link('#/summary', '總覽', h === '#/summary')}
            {link('#/validation', '信效度驗證', h === '#/validation')}
          </nav>
        </div>
      </header>
      <main>
        {test ? <TestPage key={test} test={test} /> : h === '#/summary' ? <Summary /> : h === '#/validation' ? <Validation /> : <SessionPage />}
      </main>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
