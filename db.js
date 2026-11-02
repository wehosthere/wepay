const mongoose = require('mongoose');
const dns = require('dns');

// Configura resolvedores DNS públicos (Google / Cloudflare) para evitar ECONNREFUSED em registros SRV do Atlas
try {
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
} catch (e) {
  // ignora se não suportado
}

// Schema de Pagamentos (Cobranças C2B)
const paymentSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  status: { type: String, enum: ['pending', 'processing', 'paid', 'failed', 'cancelled'], default: 'pending' },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'MZN' },
  reference: { type: String, required: true },
  phone: { type: String, required: true },
  operator: { type: String, enum: ['mpesa', 'emola'], default: 'mpesa' },
  description: { type: String, default: 'Cobrança' },
  productId: { type: String, default: null },
  failureReason: { type: String, default: null },
  paidAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Schema de Infoprodutos
const productSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  currency: { type: String, default: 'MZN' },
  description: { type: String, default: '' },
  deliveryType: { type: String, enum: ['download', 'link'], default: 'download' },
  deliveryUrl: { type: String, required: true },
  deliveryMessage: { type: String, default: 'Obrigado pela sua compra! O seu acesso foi liberado.' },
  salesCount: { type: Number, default: 0 },
  revenue: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const Payment = mongoose.model('Payment', paymentSchema);
const Product = mongoose.model('Product', productSchema);

let isConnected = false;

async function connectMongo(uri) {
  if (!uri) {
    console.warn('⚠️ [MongoDB] MONGODB_URI não informada no .env. Operando em modo de memória local.');
    return false;
  }

  try {
    mongoose.set('strictQuery', false);
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 8000
    });
    isConnected = true;
    console.log('✅ [MongoDB] Conectado com sucesso ao banco de dados Atlas: wepaydb');

    // Seed inicial de produtos se o banco estiver vazio
    const countProds = await Product.countDocuments();
    if (countProds === 0) {
      await Product.create([
        {
          id: "prod_ebook_01",
          name: "E-book: Guia Prático de Finanças Pessoais",
          price: 250,
          currency: "MZN",
          description: "Aprenda a poupar, gerir o seu dinheiro e investir com segurança.",
          deliveryType: "download",
          deliveryUrl: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
          deliveryMessage: "Obrigado pela sua compra! O seu guia financeiro está pronto para download.",
          salesCount: 1,
          revenue: 250
        },
        {
          id: "prod_grupo_vip",
          name: "Acesso Grupo VIP de Networking & Vendas",
          price: 500,
          currency: "MZN",
          description: "Comunidade exclusiva no WhatsApp para empreendedores e produtores digitais.",
          deliveryType: "link",
          deliveryUrl: "https://chat.whatsapp.com/exemplo-vip-wepay",
          deliveryMessage: "Acesso VIP liberado! Clique no botão abaixo para ingressar no grupo oficial.",
          salesCount: 0,
          revenue: 0
        }
      ]);
      console.log('📦 [MongoDB] Produtos de exemplo inseridos no banco de dados.');
    }

    return true;
  } catch (err) {
    console.error('❌ [MongoDB] Erro ao conectar ao MongoDB Atlas:', err.message);
    return false;
  }
}

module.exports = {
  Payment,
  Product,
  connectMongo,
  isDbConnected: () => isConnected
};
