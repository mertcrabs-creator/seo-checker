import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Component } from 'react';

/**
 * Bir bölümde oluşan render hatası tüm uygulamayı (boş/siyah ekran) düşürmesin; sadece o bölüm hata kartı gösterir.
 * `key` değiştiğinde (ör. sayfa/sekme değişimi) hata durumu sıfırlanır.
 */
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ui]', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card">
        <div className="empty">
          <div className="empty-icon" style={{ background: 'var(--critical-soft)', color: 'var(--critical)' }}><AlertTriangle size={24} /></div>
          <h3>Bu bölüm yüklenirken bir hata oluştu</h3>
          <p style={{ maxWidth: 460 }}>
            Sunucu kapalı veya güncel değilse bu hata görülebilir. Sunucunun çalıştığından emin olup tekrar deneyin.
          </p>
          <code className="muted" style={{ fontSize: 12, maxWidth: 560, wordBreak: 'break-word' }}>{String(this.state.error?.message || this.state.error)}</code>
          <div className="row">
            <button className="btn btn-secondary" onClick={() => this.setState({ error: null })}><RotateCcw size={15} /> Tekrar dene</button>
            <button className="btn btn-primary" onClick={() => window.location.reload()}>Sayfayı yenile</button>
          </div>
        </div>
      </div>
    );
  }
}
