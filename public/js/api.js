// api.js — FechaFácil (Supabase backend)

const SUPA_URL = 'https://rauxfeittdarpsaikynp.supabase.co';
const SUPA_KEY = 'sb_publishable_NMSSt7zrrdfm7vappE9V5A_RNe4UHbF';

// Tradução de erros do Supabase para PT-BR
function _traduzErro(msg = '') {
  const map = [
    ['User already registered',                    'Este email já está cadastrado'],
    ['Invalid login credentials',                  'Email ou senha incorretos'],
    ['Email not confirmed',                        'Confirme seu email antes de entrar'],
    ['Password should be at least 6 characters',  'A senha deve ter pelo menos 6 caracteres'],
    ['Unable to validate email address',           'Formato de email inválido'],
    ['Signup requires a valid password',           'Informe uma senha válida'],
    ['permission denied',                          'Sem permissão — contate o suporte'],
    ['JWT expired',                                'Sessão expirada, faça login novamente'],
    ['invalid claim',                              'Sessão inválida, faça login novamente'],
    ['duplicate key',                              'Registro duplicado'],
    ['violates not-null',                          'Preencha todos os campos obrigatórios'],
  ];
  for (const [en, pt] of map) {
    if (msg.toLowerCase().includes(en.toLowerCase())) return pt;
  }
  return msg || 'Erro desconhecido';
}

const API = {
  // ── Storage ──────────────────────────────────────────────────────────────
  token()  { return localStorage.getItem('ff_token'); },
  userId() { return localStorage.getItem('ff_uid'); },

  // ── HTTP helpers ─────────────────────────────────────────────────────────
  _h(extra = {}) {
    const h = { 'Content-Type': 'application/json', 'apikey': SUPA_KEY };
    if (this.token()) h['Authorization'] = `Bearer ${this.token()}`;
    return { ...h, ...extra };
  },

  async _rest(method, path, { body, single } = {}) {
    const h = this._h({ 'Prefer': 'return=representation' });
    if (single) h['Accept'] = 'application/vnd.pgrst.object+json';
    const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
      method, headers: h,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    if (res.status === 204 || method === 'DELETE') return null;
    const data = await res.json();
    if (!res.ok) {
      const raw = data.message || data.hint || data.details || data.error || 'Erro';
      if (raw.includes('JWT expired') || raw.includes('invalid claim')) {
        ['ff_token','ff_uid','ff_user'].forEach(k => localStorage.removeItem(k));
        window.location.href = '/index.html';
        return;
      }
      throw new Error(_traduzErro(raw));
    }
    return data;
  },

  async _auth(path, body) {
    const res = await fetch(`${SUPA_URL}/auth/v1${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPA_KEY },
      body: JSON.stringify(body)
    });
    const d = await res.json();
    if (!res.ok) throw new Error(_traduzErro(d.error_description || d.msg || d.error || ''));
    return d;
  },

  // ── Auth ─────────────────────────────────────────────────────────────────
  async login({ email, password }) {
    const d = await this._auth('/token?grant_type=password', { email, password });
    localStorage.setItem('ff_token', d.access_token);
    localStorage.setItem('ff_uid',   d.user.id);
    const profile = await this._rest('GET', `profiles?id=eq.${d.user.id}`, { single: true });
    const user = { ...profile, email };
    localStorage.setItem('ff_user', JSON.stringify(user));
    return { token: d.access_token, user };
  },

  async register({ name, profession, city, phone, email, password }) {
    const d = await this._auth('/signup', { email, password });
    if (!d.access_token) throw new Error('Verifique seu email para confirmar o cadastro');
    localStorage.setItem('ff_token', d.access_token);
    localStorage.setItem('ff_uid',   d.user.id);

    const base = name.toLowerCase().normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;

    const profile = await this._rest('POST', 'profiles', {
      body: { id: d.user.id, name, profession, city, phone, slug }, single: true
    });
    const user = { ...profile, email };
    localStorage.setItem('ff_user', JSON.stringify(user));
    return { token: d.access_token, user };
  },

  async me() {
    const cached = JSON.parse(localStorage.getItem('ff_user') || '{}');
    const profile = await this._rest('GET', `profiles?id=eq.${this.userId()}`, { single: true });
    return { ...profile, email: cached.email || '' };
  },

  async updateMe(data) {
    const profile = await this._rest('PATCH', `profiles?id=eq.${this.userId()}`, {
      body: data, single: true
    });
    const cached = JSON.parse(localStorage.getItem('ff_user') || '{}');
    const user = { ...profile, email: cached.email };
    localStorage.setItem('ff_user', JSON.stringify(user));
    return user;
  },

  // ── Services ──────────────────────────────────────────────────────────────
  getServices:   ()      => API._rest('GET',    `services?user_id=eq.${API.userId()}&order=created_at.asc`),
  createService: (b)     => API._rest('POST',   'services', { body: { ...b, user_id: API.userId() }, single: true }),
  updateService: (id, b) => API._rest('PATCH',  `services?id=eq.${id}`, { body: b, single: true }),
  deleteService: (id)    => API._rest('DELETE',  `services?id=eq.${id}`),

  // ── Clients ───────────────────────────────────────────────────────────────
  async getClients() {
    const rows = await this._rest('GET',
      `clients?user_id=eq.${this.userId()}&select=*,quotes(id,total,created_at)&order=created_at.desc`
    );
    return rows.map(c => {
      const qs = (c.quotes || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return { ...c, quote_count: qs.length, last_quote: qs[0]?.created_at || null };
    });
  },

  getClient:    (id)    => API._rest('GET',   `clients?id=eq.${id}&select=*,quotes(id,status,total,created_at)`, { single: true }),
  createClient: (b)     => API._rest('POST',  'clients', { body: { ...b, user_id: API.userId() }, single: true }),
  updateClient: (id, b) => API._rest('PATCH', `clients?id=eq.${id}`, { body: b, single: true }),

  // ── Quotes ────────────────────────────────────────────────────────────────
  getQuotes: () => API._rest('GET', `quotes?user_id=eq.${API.userId()}&order=created_at.desc`),

  async getQuote(id) {
    const q = await API._rest('GET', `quotes?id=eq.${id}&select=*,quote_items(*)`, { single: true });
    return { ...q, items: q.quote_items || [] };
  },

  async createQuote({ client_name, client_phone, client_email, items, notes, valid_until, discount = 0 }) {
    const subtotal = items.reduce((s, i) => s + (Number(i.quantity) || 1) * Number(i.unit_price), 0);
    const total = Math.max(0, subtotal - Number(discount));
    const quote = await API._rest('POST', 'quotes', {
      body: { user_id: API.userId(), client_name, client_phone, client_email, notes, valid_until, discount, total },
      single: true
    });
    if (items.length) {
      await API._rest('POST', 'quote_items', {
        body: items.map(i => ({
          quote_id:    quote.id,
          description: i.description,
          quantity:    Number(i.quantity) || 1,
          unit_price:  Number(i.unit_price),
          total:       (Number(i.quantity) || 1) * Number(i.unit_price)
        }))
      });
    }
    return quote;
  },

  cancelQuote: (id) => API._rest('PATCH', `quotes?id=eq.${id}`, { body: { status: 'cancelled' } }),

  // ── Dashboard ─────────────────────────────────────────────────────────────
  async dashboard() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const [allQuotes, clients] = await Promise.all([
      API._rest('GET', `quotes?user_id=eq.${API.userId()}&select=id,client_name,status,total,created_at&order=created_at.desc`),
      API._rest('GET', `clients?user_id=eq.${API.userId()}&select=id`)
    ]);

    const month          = allQuotes.filter(q => q.created_at >= monthStart);
    const month_approved = month.filter(q => q.status === 'approved').length;
    const month_revenue  = month.filter(q => q.status === 'approved').reduce((s, q) => s + Number(q.total), 0);
    const month_quotes   = month.length;
    const conversion     = month_quotes ? Math.round((month_approved / month_quotes) * 100) : 0;
    const pending_quotes = allQuotes.filter(q => q.status === 'sent').length;

    return {
      month_revenue, month_approved, month_quotes, conversion,
      pending_quotes, total_clients: clients.length,
      recent_quotes: allQuotes.slice(0, 5)
    };
  },

  // ── Public (sem auth) ─────────────────────────────────────────────────────
  async getPublicQuote(token) {
    const rows = await fetch(
      `${SUPA_URL}/rest/v1/quotes?token=eq.${token}&select=*,quote_items(*)`,
      { headers: { 'apikey': SUPA_KEY } }
    ).then(r => r.json());
    if (!rows?.length) throw new Error('Orçamento não encontrado');
    return { ...rows[0], items: rows[0].quote_items || [] };
  },

  approveQuote(token, approved_by) {
    return fetch(`${SUPA_URL}/rest/v1/quotes?token=eq.${token}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPA_KEY, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ status: 'approved', approved_by, approved_at: new Date().toISOString() })
    });
  },

  declineQuote(token) {
    return fetch(`${SUPA_URL}/rest/v1/quotes?token=eq.${token}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPA_KEY, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ status: 'declined' })
    });
  },
};

// ── Globais ───────────────────────────────────────────────────────────────
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'show ' + type;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = ''; }, 3000);
}

function formatMoney(v) {
  return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(d) {
  if (!d) return '';
  return new Date(d + 'T12:00:00').toLocaleDateString('pt-BR');
}

function timeAgo(d) {
  const diff = Date.now() - new Date(d);
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Hoje';
  if (days === 1) return 'Ontem';
  if (days < 7)  return `${days} dias atrás`;
  return formatDate(d);
}

function initials(name) {
  if (!name) return '?';
  return name.trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function statusLabel(s) {
  const map = { sent: 'Aguardando', approved: 'Aprovado', declined: 'Recusado', expired: 'Expirado', cancelled: 'Cancelado' };
  return map[s] || s;
}

function requireAuth() {
  if (!API.token()) { window.location.href = '/index.html'; return false; }
  return true;
}

function logout() {
  fetch(`${SUPA_URL}/auth/v1/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPA_KEY, 'Authorization': `Bearer ${API.token()}` }
  }).catch(() => {});
  ['ff_token','ff_uid','ff_user'].forEach(k => localStorage.removeItem(k));
  window.location.href = '/index.html';
}
