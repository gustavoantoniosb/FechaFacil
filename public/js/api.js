// API helper — todas as chamadas ao backend passam por aqui

const API = {
  base: '',

  token() { return localStorage.getItem('ff_token'); },
  user()  { return JSON.parse(localStorage.getItem('ff_user') || 'null'); },

  headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.token()) h['Authorization'] = `Bearer ${this.token()}`;
    return h;
  },

  async req(method, path, body) {
    const opts = { method, headers: this.headers() };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(this.base + path, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro desconhecido');
    return data;
  },

  get:    (p)    => API.req('GET',    p),
  post:   (p, b) => API.req('POST',   p, b),
  put:    (p, b) => API.req('PUT',    p, b),
  delete: (p)    => API.req('DELETE', p),

  // Auth
  login:    (b) => API.post('/api/auth/login', b),
  register: (b) => API.post('/api/auth/register', b),
  me:       ()  => API.get('/api/me'),
  updateMe: (b) => API.put('/api/me', b),

  // Services
  getServices:    ()     => API.get('/api/services'),
  createService:  (b)    => API.post('/api/services', b),
  updateService:  (id,b) => API.put(`/api/services/${id}`, b),
  deleteService:  (id)   => API.delete(`/api/services/${id}`),

  // Clients
  getClients:  ()     => API.get('/api/clients'),
  getClient:   (id)   => API.get(`/api/clients/${id}`),
  createClient:(b)    => API.post('/api/clients', b),
  updateClient:(id,b) => API.put(`/api/clients/${id}`, b),

  // Quotes
  getQuotes:   ()     => API.get('/api/quotes'),
  getQuote:    (id)   => API.get(`/api/quotes/${id}`),
  createQuote: (b)    => API.post('/api/quotes', b),
  cancelQuote: (id)   => API.put(`/api/quotes/${id}/cancel`),

  // Dashboard
  dashboard: () => API.get('/api/dashboard'),

  // Public (sem auth)
  getPublicQuote:  (token) => fetch(`/api/q/${token}`).then(r => r.json()),
  approveQuote:    (token, name) => fetch(`/api/q/${token}/approve`, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ approved_by: name })
  }).then(r => r.json()),
  declineQuote:    (token) => fetch(`/api/q/${token}/decline`, { method: 'POST' }).then(r => r.json()),
};

// Utilitários globais
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'show ' + type;
  setTimeout(() => { el.className = ''; }, 3000);
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
  if (days < 7) return `${days} dias atrás`;
  return formatDate(d);
}

function initials(name) {
  if (!name) return '?';
  return name.trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function statusLabel(s) {
  const map = { sent:'Aguardando', approved:'Aprovado', declined:'Recusado', expired:'Expirado', cancelled:'Cancelado' };
  return map[s] || s;
}

function requireAuth() {
  if (!API.token()) { window.location.href = '/index.html'; return false; }
  return true;
}

function logout() {
  localStorage.removeItem('ff_token');
  localStorage.removeItem('ff_user');
  window.location.href = '/index.html';
}
