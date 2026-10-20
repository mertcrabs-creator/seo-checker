import { FileText, Link2, Mail, Megaphone, MessageCircle, MousePointerClick, Phone, Search, Share2, Sparkles, Target } from 'lucide-react';

export const CHANNELS = {
  organic: { label: 'Organik arama', icon: Search },
  ai: { label: 'Yapay zekâ', icon: Sparkles },
  paid: { label: 'Reklam', icon: Megaphone },
  social: { label: 'Sosyal medya', icon: Share2 },
  email: { label: 'E-posta', icon: Mail },
  referral: { label: 'Yönlendiren site', icon: Link2 },
  direct: { label: 'Doğrudan', icon: MousePointerClick },
};

const SOURCE_NAMES = {
  google: 'Google', bing: 'Bing', yandex: 'Yandex', duckduckgo: 'DuckDuckGo', yahoo: 'Yahoo', ecosia: 'Ecosia', brave: 'Brave', baidu: 'Baidu',
  naver: 'Naver', seznam: 'Seznam', qwant: 'Qwant', chatgpt: 'ChatGPT', perplexity: 'Perplexity', gemini: 'Gemini', copilot: 'Copilot',
  claude: 'Claude', deepseek: 'DeepSeek', grok: 'Grok', meta_ai: 'Meta AI', you: 'You.com', poe: 'Poe', mistral: 'Mistral',
  facebook: 'Facebook', instagram: 'Instagram', x: 'X (Twitter)', linkedin: 'LinkedIn', youtube: 'YouTube', tiktok: 'TikTok',
  pinterest: 'Pinterest', reddit: 'Reddit', threads: 'Threads', telegram: 'Telegram', whatsapp: 'WhatsApp', vk: 'VK', quora: 'Quora',
  snapchat: 'Snapchat', email: 'E-posta',
};
export const sourceName = (s) => (s ? SOURCE_NAMES[s] || s : '—');

export const CONVERSIONS = {
  phone: { label: 'Telefon', icon: Phone },
  whatsapp: { label: 'WhatsApp', icon: MessageCircle },
  email: { label: 'E-posta', icon: Mail },
  form: { label: 'Form', icon: FileText },
  custom: { label: 'Özel', icon: Target },
};

export const DEVICES = { mobile: 'Mobil', tablet: 'Tablet', desktop: 'Masaüstü' };

export const RANGES = [
  { value: 1, label: 'Son 24 saat' },
  { value: 7, label: '7 gün' },
  { value: 28, label: '28 gün' },
  { value: 90, label: '90 gün' },
];

/** 45 sn · 3 dk 12 sn · 1 sa 4 dk */
export function duration(ms) {
  if (ms === null || ms === undefined) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} sn`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} dk ${s % 60} sn`;
  return `${Math.floor(m / 60)} sa ${m % 60} dk`;
}

export const ratio = (a, b) => (b ? a / b : null);

/** Google'ın gerçek kullanıcı eşikleri (p75) */
export const VITALS = {
  lcp: { label: 'LCP', good: 2500, poor: 4000, format: (v) => `${(v / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} sn` },
  inp: { label: 'INP', good: 200, poor: 500, format: (v) => `${Math.round(v)} ms` },
  cls: { label: 'CLS', good: 0.1, poor: 0.25, format: (v) => v.toLocaleString('tr-TR', { maximumFractionDigits: 3 }) },
};
export const vitalStatus = (key, v) => (v === null || v === undefined ? null : v <= VITALS[key].good ? 'good' : v <= VITALS[key].poor ? 'warning' : 'critical');
