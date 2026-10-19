import { Activity, Eye, EyeOff, Gauge, KeyRound, LineChart, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

export function AuthLayout({ children }) {
  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <div className="brand" style={{ padding: 0, color: '#fff', gap: 14 }}>
          <img src="/crabsmedia-logo-white.png" alt="CrabsMedia" className="brand-logo" width="148" height="40" style={{ height: 40 }} />
          <span style={{ width: 1, height: 26, background: 'rgba(255,255,255,0.25)' }} />
          <span className="row" style={{ gap: 8, fontSize: 14, letterSpacing: '0.02em' }}><LineChart size={16} /> SEO Panel</span>
        </div>
        <div>
          <h2>Organik trafiğinizi tek panelden yönetin.</h2>
          <p>Search Console verileri, anahtar kelime sıralamaları, site sağlığı taraması ve Core Web Vitals — hepsi bir arada.</p>
          <div style={{ marginTop: 28 }}>
            <div className="auth-feature"><span><KeyRound size={16} /></span> Anahtar kelime ve pozisyon takibi</div>
            <div className="auth-feature"><span><Activity size={16} /></span> 50+ kuralla teknik SEO denetimi</div>
            <div className="auth-feature"><span><Gauge size={16} /></span> PageSpeed & Core Web Vitals</div>
            <div className="auth-feature"><span><ShieldCheck size={16} /></span> Uçtan uca güvenli oturum yönetimi</div>
          </div>
        </div>
        <small style={{ opacity: 0.6 }}>© {new Date().getFullYear()} CrabsMedia</small>
      </aside>
      <main className="auth-main">
        <div className="auth-card">
          <img src="/crabsmedia-logo.png" alt="CrabsMedia" width="148" height="40" className="logo-on-light" style={{ height: 40, width: 'auto' }} />
          <img src="/crabsmedia-logo-white.png" alt="" aria-hidden="true" width="148" height="40" className="logo-on-dark" style={{ height: 40, width: 'auto' }} />
          {children}
        </div>
      </main>
    </div>
  );
}

export function PasswordInput({ id, value, onChange, autoComplete, placeholder }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw-wrap">
      <input
        id={id} className="input" type={show ? 'text' : 'password'} value={value} onChange={onChange}
        autoComplete={autoComplete} placeholder={placeholder} required maxLength={128}
      />
      <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => setShow((s) => !s)} aria-label={show ? 'Şifreyi gizle' : 'Şifreyi göster'}>
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}
