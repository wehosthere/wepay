const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { Payment, Product, connectMongo, isDbConnected } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const KIVORA_SECRET_KEY = process.env.KIVORA_SECRET_KEY || '';
const KIVORA_BASE_URL = (process.env.KIVORA_BASE_URL || 'https://www.kivorapayments.com').replace(/\/+$/, '');
const MONGODB_URI = process.env.MONGODB_URI || '';

// Inicia conexão assíncrona com MongoDB Atlas
connectMongo(MONGODB_URI);

// Credenciais de Administrador
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@wepay.co.mz').toLowerCase().trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ADMIN_NAME = process.env.ADMIN_NAME || 'Administrador WePay';

// Sessões ativas em memória
const activeAuthTokens = new Set();

// Modo de operação em memória (pode ser alternado dinamicamente pelo admin)
let currentPaymentMode = process.env.PAYMENT_MODE || (KIVORA_SECRET_KEY ? 'live' : 'simulator');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Caminhos dos bancos de dados JSON locais (Fallback)
const DB_PAYMENTS = path.join(__dirname, 'data', 'payments.json');
const DB_PRODUCTS = path.join(__dirname, 'data', 'products.json');

// --- CAMADA DE PERSISTÊNCIA (MONGODB + FALLBACK JSON) ---
async function getStoredPayments() {
  if (isDbConnected()) {
    try {
      const docs = await Payment.find().sort({ createdAt: -1 }).lean();
      return docs;
    } catch (e) {
      console.warn('Fallback para payments.json:', e.message);
    }
  }
  try {
    if (!fs.existsSync(DB_PAYMENTS)) return [];
    const data = fs.readFileSync(DB_PAYMENTS, 'utf8');
    return JSON.parse(data || '[]');
  } catch (err) {
    return [];
  }
}

async function upsertPayment(payment) {
  if (isDbConnected()) {
    try {
      const prev = await Payment.findOne({ id: payment.id });
      const updated = await Payment.findOneAndUpdate(
        { id: payment.id },
        { ...payment, updatedAt: new Date() },
        { upsert: true, new: true }
      );
      if (prev && prev.status !== 'paid' && (payment.status === 'paid' || payment.status === 'completed') && payment.productId) {
        await incrementProductSale(payment.productId, payment.amount);
      } else if (!prev && (payment.status === 'paid' || payment.status === 'completed') && payment.productId) {
        await incrementProductSale(payment.productId, payment.amount);
      }
      return updated;
    } catch (e) {
      console.warn('Erro MongoDB ao salvar pagamento:', e.message);
    }
  }

  // Fallback JSON
  try {
    fs.mkdirSync(path.dirname(DB_PAYMENTS), { recursive: true });
    let payments = [];
    if (fs.existsSync(DB_PAYMENTS)) {
      payments = JSON.parse(fs.readFileSync(DB_PAYMENTS, 'utf8') || '[]');
    }
    const index = payments.findIndex(p => p.id === payment.id || (payment.reference && p.reference === payment.reference));
    if (index >= 0) {
      payments[index] = { ...payments[index], ...payment };
    } else {
      payments.unshift(payment);
    }
    fs.writeFileSync(DB_PAYMENTS, JSON.stringify(payments, null, 2), 'utf8');
  } catch (err) {
    console.error('Erro ao gravar payments.json:', err);
  }
}

async function getStoredProducts() {
  if (isDbConnected()) {
    try {
      const docs = await Product.find().sort({ createdAt: -1 }).lean();
      return docs;
    } catch (e) {
      console.warn('Fallback para products.json:', e.message);
    }
  }
  try {
    if (!fs.existsSync(DB_PRODUCTS)) return [];
    const data = fs.readFileSync(DB_PRODUCTS, 'utf8');
    return JSON.parse(data || '[]');
  } catch (err) {
    return [];
  }
}

async function incrementProductSale(productId, amount) {
  if (isDbConnected()) {
    try {
      await Product.findOneAndUpdate(
        { id: productId },
        { $inc: { salesCount: 1, revenue: Number(amount || 0) } }
      );
      console.log(`[MongoDB] Venda incrementada para infoproduto: ${productId}`);
      return;
    } catch (e) {
      console.warn('Erro MongoDB ao incrementar venda:', e.message);
    }
  }

  try {
    const products = await getStoredProducts();
    const prod = products.find(p => p.id === productId);
    if (prod) {
      prod.salesCount = (prod.salesCount || 0) + 1;
      prod.revenue = (prod.revenue || 0) + Number(amount || 0);
      fs.writeFileSync(DB_PRODUCTS, JSON.stringify(products, null, 2), 'utf8');
    }
  } catch (e) {
    console.error('Erro ao incrementar produto:', e);
  }
}

// Memória local para pagamentos simulados
const mockPaymentsDb = new Map();

/**
 * ========================================================
 * ROTAS DE AUTENTICAÇÃO DO ADMINISTRADOR
 * ========================================================
 */

// Tela de Login
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Processar Login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;

  const cleanEmail = (email || '').toLowerCase().trim();
  if (cleanEmail === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    const token = `auth_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    activeAuthTokens.add(token);
    console.log(`[Auth] Login realizado com sucesso por: ${cleanEmail}`);
    return res.json({
      success: true,
      token,
      user: {
        email: ADMIN_EMAIL,
        name: ADMIN_NAME
      }
    });
  }

  res.status(401).json({
    error: {
      code: 'INVALID_CREDENTIALS',
      message: 'E-mail ou palavra-passe incorretos.'
    }
  });
});

// Verificar Sessão Atual
app.get('/api/auth/me', (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (token && activeAuthTokens.has(token)) {
    return res.json({
      authenticated: true,
      user: {
        email: ADMIN_EMAIL,
        name: ADMIN_NAME
      }
    });
  }

  res.status(401).json({ authenticated: false });
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (token) {
    activeAuthTokens.delete(token);
  }
  res.json({ success: true });
});

/**
 * Informações do gateway e modo de operação (Público)
 */
app.get('/api/config', (req, res) => {
  res.json({
    gateway: 'Kivora Payments',
    isConfigured: Boolean(KIVORA_SECRET_KEY),
    environment: currentPaymentMode,
    currency: 'MZN',
    database: isDbConnected() ? 'MongoDB Atlas (Connected)' : 'Local JSON'
  });
});

/**
 * Alternar modo no painel admin (live <-> simulator)
 */
app.post('/api/admin/mode', (req, res) => {
  const { mode } = req.body;
  if (mode === 'live' || mode === 'simulator') {
    currentPaymentMode = mode;
    console.log(`[Modo Alterado]: Agora em ${currentPaymentMode.toUpperCase()}`);
    return res.json({ success: true, mode: currentPaymentMode });
  }
  res.status(400).json({ error: { message: 'Modo inválido. Use "live" ou "simulator".' } });
});

/**
 * Rota direta para o painel administrativo
 */
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

/**
 * ========================================================
 * ROTAS DE INFOPRODUTOS (API DE PRODUTOS)
 * ========================================================
 */

// Listar todos os infoprodutos
app.get('/api/products', async (req, res) => {
  const products = await getStoredProducts();
  res.json(products);
});

// Detalhes de um infoproduto específico
app.get('/api/products/:id', async (req, res) => {
  const products = await getStoredProducts();
  const product = products.find(p => p.id === req.params.id);
  if (!product) {
    return res.status(404).json({ error: { message: 'Infoproduto não encontrado.' } });
  }
  res.json(product);
});

// Criar novo infoproduto pelo admin
app.post('/api/products', async (req, res) => {
  try {
    const { name, price, description, deliveryType, deliveryUrl, deliveryMessage } = req.body;

    if (!name || !price || !deliveryUrl) {
      return res.status(400).json({
        error: { message: 'Nome, preço e link de entrega são obrigatórios.' }
      });
    }

    const newProductData = {
      id: `prod_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      name: name.trim(),
      price: Number(price),
      currency: 'MZN',
      description: description ? description.trim() : '',
      deliveryType: deliveryType || 'download',
      deliveryUrl: deliveryUrl.trim(),
      deliveryMessage: deliveryMessage ? deliveryMessage.trim() : 'Obrigado pela sua compra! O seu acesso foi liberado.',
      createdAt: new Date(),
      salesCount: 0,
      revenue: 0
    };

    if (isDbConnected()) {
      const created = await Product.create(newProductData);
      return res.status(201).json(created);
    }

    // Fallback JSON
    const products = await getStoredProducts();
    products.unshift(newProductData);
    fs.writeFileSync(DB_PRODUCTS, JSON.stringify(products, null, 2), 'utf8');

    res.status(201).json(newProductData);
  } catch (err) {
    console.error('Erro ao criar infoproduto:', err);
    res.status(500).json({ error: { message: 'Erro ao cadastrar produto.' } });
  }
});

// Excluir infoproduto
app.delete('/api/products/:id', async (req, res) => {
  try {
    if (isDbConnected()) {
      await Product.deleteOne({ id: req.params.id });
      return res.json({ success: true });
    }
    let products = await getStoredProducts();
    products = products.filter(p => p.id !== req.params.id);
    fs.writeFileSync(DB_PRODUCTS, JSON.stringify(products, null, 2), 'utf8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: { message: 'Erro ao remover infoproduto.' } });
  }
});

/**
 * ========================================================
 * COBRANÇA C2B (CUSTOMER TO BUSINESS)
 * ========================================================
 */
async function handleSimulatedPayment(cleanPhone, amount, currency, paymentReference, description, operator, productId) {
  const simulatedId = `pay_sim_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const newPayment = {
    id: simulatedId,
    status: 'pending',
    amount: Number(amount),
    currency,
    reference: paymentReference,
    phone: cleanPhone,
    operator,
    productId: productId || null,
    description: description || 'Cobrança',
    createdAt: new Date()
  };

  mockPaymentsDb.set(simulatedId, newPayment);
  await upsertPayment(newPayment);

  // Agenda mudança de status após 6 segundos
  setTimeout(async () => {
    let record = mockPaymentsDb.get(simulatedId);
    if (!record) {
      const allP = await getStoredPayments();
      record = allP.find(p => p.id === simulatedId);
    }
    if (record && record.status === 'pending') {
      if (cleanPhone.endsWith('99')) {
        record.status = 'failed';
        record.failureReason = 'insufficient_funds';
      } else {
        record.status = 'paid';
        record.paidAt = new Date();
        if (record.productId) {
          await incrementProductSale(record.productId, record.amount);
        }
      }
      mockPaymentsDb.set(simulatedId, record);
      await upsertPayment(record);
      console.log(`[Simulador] Pagamento ${simulatedId} atualizado para: ${record.status}`);
    }
  }, 6000);

  return newPayment;
}

/**
 * POST /api/payments/c2b
 */
app.post('/api/payments/c2b', async (req, res) => {
  try {
    const { phone, amount, currency = 'MZN', reference, description, forceSimulator, productId } = req.body;

    if (!phone || !amount) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Número de telefone e montante são obrigatórios.'
        }
      });
    }

    let cleanPhone = String(phone).replace(/\D/g, '');
    if (cleanPhone.startsWith('258') && cleanPhone.length > 9) {
      cleanPhone = cleanPhone.slice(3);
    }

    if (cleanPhone.length !== 9) {
      return res.status(400).json({
        error: {
          code: 'INVALID_PHONE',
          message: 'O telemóvel deve conter 9 dígitos locais (ex: 841234567 ou 861234567).'
        }
      });
    }

    const prefix = cleanPhone.slice(0, 2);
    const operator = (prefix === '84' || prefix === '85') ? 'mpesa' : 'emola';
    const paymentReference = reference || `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // Se estiver em modo simulador ou forçado
    if (forceSimulator || currentPaymentMode === 'simulator') {
      const simulated = await handleSimulatedPayment(cleanPhone, amount, currency, paymentReference, description, operator, productId);
      return res.status(201).json({
        id: simulated.id,
        status: simulated.status,
        reference: simulated.reference,
        amount: simulated.amount,
        currency: simulated.currency,
        _simulator: true
      });
    }

    // Modo Live (Kivora Payments)
    if (KIVORA_SECRET_KEY && KIVORA_SECRET_KEY.trim().length > 10) {
      try {
        const response = await fetch(`${KIVORA_BASE_URL}/v1/c2b`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${KIVORA_SECRET_KEY.trim()}`
          },
          body: JSON.stringify({
            phone: cleanPhone,
            amount: Number(amount),
            currency,
            reference: paymentReference,
            description: description || 'Cobrança'
          })
        });

        const data = await response.json();

        if (response.status === 401 && data.error?.code === 'INVALID_API_KEY') {
          return res.status(400).json({
            error: {
              code: 'KIVORA_KEY_NOT_ACTIVE',
              message: 'A sua chave Kivora Live ainda não está ativada para transações na rede. Ative o "Modo Simulador" na barra superior para testar agora mesmo!'
            },
            canSimulate: true
          });
        }

        if (response.ok && data.id) {
          await upsertPayment({
            id: data.id,
            status: data.status || 'pending',
            amount: Number(amount),
            currency,
            reference: paymentReference,
            phone: cleanPhone,
            operator,
            productId: productId || null,
            description: description || 'Cobrança',
            createdAt: new Date()
          });
        }

        return res.status(response.status).json(data);
      } catch (networkErr) {
        console.error('Erro de conexão com a Kivora:', networkErr);
        return res.status(502).json({
          error: {
            code: 'GATEWAY_UNAVAILABLE',
            message: 'Não foi possível conectar aos servidores da Kivora Payments no momento.'
          }
        });
      }
    }

    // Fallback
    const fallbackSim = await handleSimulatedPayment(cleanPhone, amount, currency, paymentReference, description, operator, productId);
    return res.status(201).json({
      id: fallbackSim.id,
      status: fallbackSim.status,
      reference: fallbackSim.reference,
      amount: fallbackSim.amount,
      currency: fallbackSim.currency,
      _simulator: true
    });

  } catch (error) {
    console.error('Erro ao processar cobrança C2B:', error);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Ocorreu um erro no servidor ao tentar processar o pagamento.'
      }
    });
  }
});

/**
 * GET /api/payments/c2b/:paymentId
 */
app.get('/api/payments/c2b/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;
    let paymentRecord = null;

    if (mockPaymentsDb.has(paymentId)) {
      paymentRecord = mockPaymentsDb.get(paymentId);
      await upsertPayment(paymentRecord);
    } else if (KIVORA_SECRET_KEY && KIVORA_SECRET_KEY.trim().length > 10 && currentPaymentMode === 'live') {
      try {
        const response = await fetch(`${KIVORA_BASE_URL}/v1/c2b/${encodeURIComponent(paymentId)}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${KIVORA_SECRET_KEY.trim()}`
          }
        });

        const data = await response.json();
        if (response.ok && data.id) {
          const stored = (await getStoredPayments()).find(p => p.id === paymentId) || {};
          paymentRecord = {
            ...stored,
            id: data.id,
            status: data.status,
            amount: data.amount,
            currency: data.currency,
            reference: data.reference,
            updatedAt: new Date()
          };
          await upsertPayment(paymentRecord);
        }
      } catch (err) {
        console.warn('Erro ao consultar Kivora:', err.message);
      }
    }

    if (!paymentRecord) {
      paymentRecord = (await getStoredPayments()).find(p => p.id === paymentId);
    }

    if (!paymentRecord) {
      return res.status(404).json({ error: { message: 'Pagamento não encontrado.' } });
    }

    const responsePayload = { ...paymentRecord };
    if ((paymentRecord.status === 'paid' || paymentRecord.status === 'completed') && paymentRecord.productId) {
      const products = await getStoredProducts();
      const product = products.find(p => p.id === paymentRecord.productId);
      if (product) {
        responsePayload.delivery = {
          productName: product.name,
          deliveryType: product.deliveryType,
          deliveryUrl: product.deliveryUrl,
          deliveryMessage: product.deliveryMessage
        };
      }
    }

    return res.json(responsePayload);

  } catch (error) {
    console.error('Erro ao consultar status:', error);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erro ao consultar o estado da cobrança.'
      }
    });
  }
});

/**
 * ========================================================
 * ROTAS ADMINISTRATIVAS (ADMIN DASHBOARD API)
 * ========================================================
 */

// Listar todos os pagamentos
app.get('/api/admin/payments', async (req, res) => {
  const payments = await getStoredPayments();
  res.json(payments);
});

// Métricas consolidadas
app.get('/api/admin/stats', async (req, res) => {
  const payments = await getStoredPayments();
  const products = await getStoredProducts();
  
  const totalVolume = payments
    .filter(p => p.status === 'paid' || p.status === 'completed')
    .reduce((acc, p) => acc + (Number(p.amount) || 0), 0);

  const totalPaid = payments.filter(p => p.status === 'paid' || p.status === 'completed').length;
  const totalPending = payments.filter(p => p.status === 'pending' || p.status === 'processing').length;
  const totalFailed = payments.filter(p => p.status === 'failed' || p.status === 'cancelled').length;

  res.json({
    totalVolume,
    currency: 'MZN',
    totalTransactions: payments.length,
    totalPaid,
    totalPending,
    totalFailed,
    totalProducts: products.length,
    currentMode: currentPaymentMode
  });
});

/**
 * Webhooks Kivora Payments
 */
app.post('/api/webhooks/kivora', async (req, res) => {
  const event = req.body;
  console.log(`[Webhook Kivora Recebido]: Tipo: ${event.type} | ID: ${event.id}`);

  if (event && event.data && event.data.id) {
    const pData = event.data;
    let mappedStatus = 'pending';
    if (event.type === 'payment.completed') mappedStatus = 'paid';
    if (event.type === 'payment.failed') mappedStatus = 'failed';

    await upsertPayment({
      id: pData.id,
      status: mappedStatus,
      amount: pData.amount,
      currency: pData.currency || 'MZN',
      reference: pData.reference,
      phone: pData.phone,
      updatedAt: new Date()
    });
  }

  res.status(200).json({ received: true });
});

// Fallback para SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 WePay - Checkout & Painel Admin iniciado!`);
  console.log(`🌐 Checkout Cliente: http://localhost:${PORT}`);
  console.log(`🔐 Login Admin:      http://localhost:${PORT}/login`);
  console.log(`📊 Painel Admin:     http://localhost:${PORT}/admin`);
  console.log(`🗄️ Banco de Dados:   MongoDB Atlas (wepaydb)`);
  console.log(`======================================================\n`);
});
