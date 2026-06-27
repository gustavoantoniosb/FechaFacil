const express  = require('express');
const cors     = require('cors');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const path     = require('path');
const db       = require('./db');

const app = express();
const PORT       = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'fechafacil-secret-2026';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────
//  MIDDLEWARE DE AUTH
// ─────────────────────────────────────────
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Não autorizado' });
  try {
    req.user = jwt.verify(header.replace('Bearer ', ''), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

// ─────────────────────────────────────────
//  AUTH
// ─────────────────────────────────────────

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, profession, city, phone, email, password } = req.body;
    if (!name || !email || !password || !profession || !city || !phone)
      return res.status(400).json({ error: 'Preencha todos os campos' });

    const existing = await db.users.findOne({ email });
    if (existing) return res.status(400).json({ error: 'E-mail já cadastrado' });

    const password_hash = await bcrypt.hash(password, 10);
    const slug = name.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
      + '-' + Math.random().toString(36).slice(2, 6);

    const user = await db.users.insert({
      name, profession, city, phone, email, password_hash, bio: '', slug,
      created_at: new Date().toISOString()
    });

    // Serviços padrão
    const defaults = getDefaultServices(profession);
    for (let i = 0; i < defaults.length; i++) {
      await db.services.insert({ user_id: user._id, name: defaults[i].name, price: defaults[i].price, description: '', active: true, sort_order: i });
    }

    const token = jwt.sign({ id: user._id, email }, JWT_SECRET, { expiresIn: '30d' });
    const { password_hash: _, ...safe } = user;
    res.json({ token, user: { ...safe, id: user._id } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await db.users.findOne({ email });
    if (!user) return res.status(401).json({ error: 'E-mail ou senha incorretos' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'E-mail ou senha incorretos' });

    const token = jwt.sign({ id: user._id, email }, JWT_SECRET, { expiresIn: '30d' });
    const { password_hash, ...safe } = user;
    res.json({ token, user: { ...safe, id: user._id } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/me', auth, async (req, res) => {
  const user = await db.users.findOne({ _id: req.user.id });
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
  const { password_hash, ...safe } = user;
  res.json({ ...safe, id: user._id });
});

app.put('/api/me', auth, async (req, res) => {
  try {
    const { name, profession, city, phone, bio } = req.body;
    await db.users.update({ _id: req.user.id }, { $set: { name, profession, city, phone, bio: bio || '' } });
    const user = await db.users.findOne({ _id: req.user.id });
    const { password_hash, ...safe } = user;
    res.json({ ...safe, id: user._id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────
//  SERVIÇOS
// ─────────────────────────────────────────

app.get('/api/services', auth, async (req, res) => {
  const rows = await db.services.find({ user_id: req.user.id }).sort({ sort_order: 1, name: 1 });
  res.json(rows.map(s => ({ ...s, id: s._id })));
});

app.post('/api/services', auth, async (req, res) => {
  try {
    const { name, description, price } = req.body;
    if (!name || price == null) return res.status(400).json({ error: 'Nome e preço obrigatórios' });
    const s = await db.services.insert({ user_id: req.user.id, name, description: description || '', price: Number(price), active: true, sort_order: 99 });
    res.json({ ...s, id: s._id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/services/:id', auth, async (req, res) => {
  try {
    const { name, description, price, active } = req.body;
    await db.services.update({ _id: req.params.id, user_id: req.user.id }, { $set: { name, description: description || '', price: Number(price), active: !!active } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/services/:id', auth, async (req, res) => {
  await db.services.remove({ _id: req.params.id, user_id: req.user.id });
  res.json({ ok: true });
});

// ─────────────────────────────────────────
//  CLIENTES
// ─────────────────────────────────────────

app.get('/api/clients', auth, async (req, res) => {
  const clients = await db.clients.find({ user_id: req.user.id }).sort({ name: 1 });
  // Enriquecer com contagem de orçamentos
  const enriched = await Promise.all(clients.map(async c => {
    const quotes = await db.quotes.find({ client_id: c._id }).sort({ created_at: -1 });
    return {
      ...c, id: c._id,
      quote_count: quotes.length,
      last_quote: quotes[0]?.created_at || null
    };
  }));
  res.json(enriched);
});

app.post('/api/clients', auth, async (req, res) => {
  try {
    const { name, phone, email, address, notes } = req.body;
    if (!name || !phone) return res.status(400).json({ error: 'Nome e telefone obrigatórios' });
    const c = await db.clients.insert({ user_id: req.user.id, name, phone, email: email || '', address: address || '', notes: notes || '', created_at: new Date().toISOString() });
    res.json({ ...c, id: c._id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/clients/:id', auth, async (req, res) => {
  const client = await db.clients.findOne({ _id: req.params.id, user_id: req.user.id });
  if (!client) return res.status(404).json({ error: 'Cliente não encontrado' });
  const quotes = await db.quotes.find({ client_id: client._id }).sort({ created_at: -1 });
  res.json({ ...client, id: client._id, quotes: quotes.map(q => ({ ...q, id: q._id })) });
});

app.put('/api/clients/:id', auth, async (req, res) => {
  try {
    const { name, phone, email, address, notes } = req.body;
    await db.clients.update({ _id: req.params.id, user_id: req.user.id }, { $set: { name, phone, email: email || '', address: address || '', notes: notes || '' } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────
//  ORÇAMENTOS
// ─────────────────────────────────────────

app.get('/api/quotes', auth, async (req, res) => {
  const quotes = await db.quotes.find({ user_id: req.user.id }).sort({ created_at: -1 });
  res.json(quotes.map(q => ({ ...q, id: q._id })));
});

app.post('/api/quotes', auth, async (req, res) => {
  try {
    const { client_id, client_name, client_phone, items, discount, notes, valid_days } = req.body;
    if (!items || items.length === 0) return res.status(400).json({ error: 'Adicione pelo menos um serviço' });
    if (!client_name || !client_phone) return res.status(400).json({ error: 'Cliente obrigatório' });

    const subtotal = items.reduce((s, i) => s + (i.quantity * i.unit_price), 0);
    const disc     = Number(discount) || 0;
    const total    = subtotal - disc;
    const token    = uuidv4().replace(/-/g, '').slice(0, 12);

    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + (Number(valid_days) || 5));

    const quote = await db.quotes.insert({
      user_id:      req.user.id,
      client_id:    client_id || null,
      client_name,
      client_phone,
      token,
      status:       'sent',
      subtotal,
      discount:     disc,
      total,
      notes:        notes || '',
      valid_until:  validUntil.toISOString().split('T')[0],
      approved_at:  null,
      approved_by:  null,
      created_at:   new Date().toISOString()
    });

    // Inserir itens
    for (const it of items) {
      await db.quote_items.insert({
        quote_id:   quote._id,
        description: it.description,
        quantity:    it.quantity,
        unit_price:  it.unit_price,
        total:       it.quantity * it.unit_price
      });
    }

    res.json({ ...quote, id: quote._id, link: `/q/${token}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/quotes/:id', auth, async (req, res) => {
  const quote = await db.quotes.findOne({ _id: req.params.id, user_id: req.user.id });
  if (!quote) return res.status(404).json({ error: 'Orçamento não encontrado' });
  const items = await db.quote_items.find({ quote_id: quote._id });
  res.json({ ...quote, id: quote._id, items: items.map(i => ({ ...i, id: i._id })) });
});

app.put('/api/quotes/:id/cancel', auth, async (req, res) => {
  await db.quotes.update({ _id: req.params.id, user_id: req.user.id }, { $set: { status: 'cancelled' } });
  res.json({ ok: true });
});

// ─────────────────────────────────────────
//  ORÇAMENTO PÚBLICO (sem auth)
// ─────────────────────────────────────────

app.get('/api/q/:token', async (req, res) => {
  try {
    const quote = await db.quotes.findOne({ token: req.params.token });
    if (!quote) return res.status(404).json({ error: 'Orçamento não encontrado' });

    // Checar expiração
    if (quote.valid_until && new Date(quote.valid_until) < new Date() && quote.status === 'sent') {
      await db.quotes.update({ _id: quote._id }, { $set: { status: 'expired' } });
      quote.status = 'expired';
    }

    const items = await db.quote_items.find({ quote_id: quote._id });
    const user  = await db.users.findOne({ _id: quote.user_id });
    const { password_hash, ...safeUser } = user;

    res.json({ ...quote, id: quote._id, items: items.map(i => ({ ...i, id: i._id })), professional: { ...safeUser, id: user._id } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/q/:token/approve', async (req, res) => {
  try {
    const { approved_by } = req.body;
    if (!approved_by) return res.status(400).json({ error: 'Nome obrigatório para aprovar' });

    const quote = await db.quotes.findOne({ token: req.params.token });
    if (!quote) return res.status(404).json({ error: 'Orçamento não encontrado' });
    if (quote.status !== 'sent') return res.status(400).json({ error: 'Este orçamento não pode ser aprovado' });

    await db.quotes.update({ token: req.params.token }, { $set: { status: 'approved', approved_at: new Date().toISOString(), approved_by } });
    res.json({ ok: true, message: 'Orçamento aprovado com sucesso!' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/q/:token/decline', async (req, res) => {
  try {
    const quote = await db.quotes.findOne({ token: req.params.token });
    if (!quote) return res.status(404).json({ error: 'Não encontrado' });
    if (quote.status !== 'sent') return res.status(400).json({ error: 'Não pode ser recusado' });
    await db.quotes.update({ token: req.params.token }, { $set: { status: 'declined' } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────
//  DASHBOARD
// ─────────────────────────────────────────

app.get('/api/dashboard', auth, async (req, res) => {
  try {
    const uid   = req.user.id;
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM

    const allQuotes   = await db.quotes.find({ user_id: uid });
    const monthQuotes = allQuotes.filter(q => q.created_at?.startsWith(month));
    const approved    = monthQuotes.filter(q => q.status === 'approved');
    const pending     = allQuotes.filter(q => q.status === 'sent');
    const clients     = await db.clients.find({ user_id: uid });
    const recent      = allQuotes.sort((a, b) => b.created_at > a.created_at ? 1 : -1).slice(0, 5);

    res.json({
      month_quotes:   monthQuotes.length,
      month_approved: approved.length,
      month_revenue:  approved.reduce((s, q) => s + q.total, 0),
      conversion:     monthQuotes.length > 0 ? Math.round((approved.length / monthQuotes.length) * 100) : 0,
      pending_quotes: pending.length,
      total_clients:  clients.length,
      recent_quotes:  recent.map(q => ({ ...q, id: q._id }))
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────
//  MINI-SITE DO PROFISSIONAL
// ─────────────────────────────────────────

app.get('/api/minisite/:slug', async (req, res) => {
  try {
    const user = await db.users.findOne({ slug: req.params.slug });
    if (!user) return res.status(404).json({ error: 'Profissional não encontrado' });
    const services = await db.services.find({ user_id: user._id }).sort({ sort_order: 1 });
    const { password_hash, ...safe } = user;
    res.json({ user: { ...safe, id: user._id }, services: services.map(s => ({ ...s, id: s._id })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────
//  ROTAS DO FRONTEND
// ─────────────────────────────────────────

app.get('/q/:token',  (_req, res) => res.sendFile(path.join(__dirname, 'public', 'quote-public.html')));
app.get('/:slug',     (req,  res) => {
  const known = ['dashboard.html','quotes.html','quote-new.html','clients.html','profile.html','minisite.html'];
  if (!known.includes(req.params.slug) && !req.params.slug.includes('.'))
    return res.sendFile(path.join(__dirname, 'public', 'minisite.html'));
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─────────────────────────────────────────
//  START
// ─────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`🚀 FechaFácil rodando em http://localhost:${PORT}`);
  console.log(`   Banco de dados: ./data/`);
});

// ─────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────

function getDefaultServices(profession) {
  const map = {
    'Eletricista': [
      { name: 'Instalação de tomadas (un.)', price: 60 },
      { name: 'Troca de disjuntor', price: 80 },
      { name: 'Instalação de interruptores', price: 50 },
      { name: 'Instalação de lustres / luminárias', price: 90 },
      { name: 'Passagem de fiação (m)', price: 25 },
      { name: 'Quadro de distribuição', price: 200 },
      { name: 'Mão de obra', price: 100 },
    ],
    'Encanador': [
      { name: 'Desentupimento de pia', price: 150 },
      { name: 'Troca de torneira', price: 80 },
      { name: 'Conserto de vaso sanitário', price: 100 },
      { name: 'Instalação de chuveiro', price: 120 },
      { name: 'Vazamento em tubulação', price: 180 },
      { name: 'Mão de obra', price: 100 },
    ],
    'Técnico de Ar-condicionado': [
      { name: 'Limpeza de split (un.)', price: 150 },
      { name: 'Instalação de ar-condicionado', price: 350 },
      { name: 'Recarga de gás', price: 200 },
      { name: 'Manutenção preventiva', price: 120 },
    ],
    'Pintor': [
      { name: 'Pintura (m²)', price: 15 },
      { name: 'Massa corrida (m²)', price: 12 },
      { name: 'Pintura de fachada (m²)', price: 20 },
      { name: 'Mão de obra diária', price: 250 },
    ],
    'Técnico de Informática': [
      { name: 'Formatação de computador', price: 120 },
      { name: 'Limpeza e manutenção', price: 80 },
      { name: 'Instalação de programas', price: 60 },
      { name: 'Configuração de rede Wi-Fi', price: 100 },
      { name: 'Remoção de vírus', price: 90 },
    ],
  };
  return map[profession] || [
    { name: 'Serviço avulso', price: 100 },
    { name: 'Mão de obra', price: 100 },
    { name: 'Consultoria', price: 150 },
  ];
}
