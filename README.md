# Checkout de Cobranças Kivora Payments (Tema Branco / Clean White)

Solução completa de checkout de cobranças online integrada à API da **Kivora Payments** (Moçambique - M-Pesa & e-Mola), desenhada com um **tema branco refinado, moderno e minimalista**.

---

## 🌟 Principais Recursos

- **Design em Tema Branco (Clean Aesthetic):** Interface inspirada nas melhores fintechs globais (Apple, Stripe), com paleta clara, tipografia apurada e responsividade para dispositivos móveis e desktop.
- **Integração C2B Nativa:** Inicia cobranças via `POST /v1/c2b` solicitando autorização com PIN direto no telemóvel do cliente (Push USSD).
- **Detecção Automática de Operadora:** Reconhece instantaneamente se o número pertence ao **M-Pesa** (prefixos 84/85) ou **e-Mola** (prefixos 86/87).
- **Acompanhamento em Tempo Real (Polling & Timeout):** Tela interativa com contagem decrescente e consulta contínua do estado (`pending`, `processing`, `paid`, `failed`).
- **Recibo Digital Imprimível:** Comprovativo detalhado após a aprovação com suporte nativo a impressão (`Ctrl+P` / `Cmd+P`).
- **Arquitetura Segura:** A Secret Key de API fica estritamente no backend Node.js, nunca exposta no client-side.
- **Simulador Interativo Embutido:** Permite testar o fluxo completo de checkout e aprovação sem precisar de credenciais imediatas.

---

## 🚀 Como Executar

### 1. Instalar as dependências
```bash
npm install
```

### 2. Configurar Variáveis de Ambiente
Copie o arquivo `.env.example` para `.env`:
```env
PORT=3000
KIVORA_SECRET_KEY=sua_chave_kivora
KIVORA_BASE_URL=https://www.kivorapayments.com
```

> **Nota:** Se deixar a variável `KIVORA_SECRET_KEY` vazia, o sistema entrará automaticamente em **Modo Demonstração (Simulador)**, aprovando o pagamento de teste em ~7 segundos para permitir testes de interface imediatos! Para simular falha no modo de teste, use um número terminado em `99`.

### 3. Iniciar o Servidor
```bash
npm start
```
Aceda no seu navegador a: **[http://localhost:3000](http://localhost:3000)**

---

## 🔗 Endpoints da Aplicação

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/` | Interface do Checkout (Tema Branco) |
| `GET` | `/api/config` | Verifica se o gateway está em Live, Testnet ou Simulador |
| `POST` | `/api/payments/c2b` | Inicia cobrança C2B via Kivora API |
| `GET` | `/api/payments/c2b/:id`| Consulta o status atual da cobrança (`/v1/c2b/{id}`) |
| `POST` | `/api/webhooks/kivora`| Endpoint receptor de Webhooks da Kivora (`payment.completed`, etc.) |

---

## 🛡️ Webhooks da Kivora Payments

Para receber atualizações assíncronas em tempo real da Kivora:
1. Configure o URL do webhook no seu painel da Kivora: `https://seu-dominio.com/api/webhooks/kivora`.
2. O endpoint responderá com HTTP 200 `{ "received": true }` e registrará os eventos como `payment.completed` e `payment.failed`.

---

Desenvolvido para pagamentos rápidos, elegantes e seguros em Meticais (MZN).

