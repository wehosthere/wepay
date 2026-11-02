/**
 * KIVORA PAYMENTS - CLIENT-SIDE CHECKOUT CONTROLLER
 * Manipula a interface, validações, polling e transições de estado.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Configurações do Pedido Atual
  const urlParams = new URLSearchParams(window.location.search);
  const checkoutConfig = {
    amount: parseFloat(urlParams.get('amount')) || 100,
    currency: urlParams.get('currency') || 'MZN',
    reference: urlParams.get('ref') || `ORD-${Math.floor(1000 + Math.random() * 9000)}`,
    description: urlParams.get('desc') || 'Cobrança',
    productId: urlParams.get('product') || null
  };

  // Elementos do DOM
  const displayAmount = document.getElementById('displayAmount');
  const displayReference = document.getElementById('displayReference');
  const orderDescription = document.getElementById('orderDescription');
  const subtotalVal = document.getElementById('subtotalVal');
  const totalVal = document.getElementById('totalVal');
  const btnPayAmount = document.getElementById('btnPayAmount');
  const envBadge = document.getElementById('envBadge');

  // Steps
  const stepForm = document.getElementById('stepForm');
  const stepPending = document.getElementById('stepPending');
  const stepSuccess = document.getElementById('stepSuccess');
  const stepFailed = document.getElementById('stepFailed');

  // Form & Inputs
  const checkoutForm = document.getElementById('checkoutForm');
  const phoneInput = document.getElementById('phoneNumber');
  const customerNameInput = document.getElementById('customerName');
  const customerEmailInput = document.getElementById('customerEmail');
  const operatorPill = document.getElementById('operatorPill');
  const operatorPillText = document.getElementById('operatorPillText');
  const providerOptions = document.querySelectorAll('.provider-btn, .provider-option');
  const btnSubmitPayment = document.getElementById('btnSubmitPayment');
  const btnSpinner = btnSubmitPayment?.querySelector('.btn-spinner');
  const btnArrow = btnSubmitPayment?.querySelector('.btn-arrow');
  const btnText = btnSubmitPayment?.querySelector('.btn-text');
  const formErrorMessage = document.getElementById('formErrorMessage');
  const errorText = document.getElementById('errorText');

  // Pending State
  const pendingPhoneNumber = document.getElementById('pendingPhoneNumber');
  const countdownTimer = document.getElementById('countdownTimer');
  const countdownProgress = document.getElementById('countdownProgress');
  const pollingStatusText = document.getElementById('pollingStatusText');
  const btnCheckStatusNow = document.getElementById('btnCheckStatusNow');
  const btnCancelPayment = document.getElementById('btnCancelPayment');

  // Success State
  const receiptId = document.getElementById('receiptId');
  const receiptRef = document.getElementById('receiptRef');
  const receiptPhone = document.getElementById('receiptPhone');
  const receiptDate = document.getElementById('receiptDate');
  const receiptAmount = document.getElementById('receiptAmount');
  const btnPrintReceipt = document.getElementById('btnPrintReceipt');
  const btnNewPayment = document.getElementById('btnNewPayment');

  // Failed State
  const failedReasonText = document.getElementById('failedReasonText');
  const btnTryAgain = document.getElementById('btnTryAgain');

  // Variáveis de Controle
  let activePaymentId = null;
  let pollingInterval = null;
  let countdownInterval = null;
  const TOTAL_COUNTDOWN_SECONDS = 90;
  let remainingSeconds = TOTAL_COUNTDOWN_SECONDS;

  // Formatar valores monetários em MZN
  function formatMoney(amount) {
    return new Intl.NumberFormat('pt-MZ', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  }

  // Inicializa dados na tela
  async function initCheckoutView() {
    // Se tiver productId na URL, busca dados do infoproduto
    if (checkoutConfig.productId) {
      try {
        const prodRes = await fetch(`/api/products/${checkoutConfig.productId}`);
        if (prodRes.ok) {
          const product = await prodRes.json();
          checkoutConfig.amount = product.price;
          checkoutConfig.description = product.name;
          if (product.currency) checkoutConfig.currency = product.currency;
        }
      } catch (e) {
        console.warn('Erro ao carregar dados do infoproduto:', e);
      }
    }

    const formattedPrice = formatMoney(checkoutConfig.amount);
    displayAmount.textContent = formattedPrice;
    if (subtotalVal) subtotalVal.textContent = `${formattedPrice} MZN`;
    if (totalVal) totalVal.textContent = `${formattedPrice} MZN`;
    btnPayAmount.textContent = `${formattedPrice} MZN`;
    displayReference.textContent = checkoutConfig.reference;
    orderDescription.textContent = checkoutConfig.description;

    // Busca o status do gateway no backend
    fetchGatewayConfig();
  }

  // Verifica configuração do servidor e ambiente Kivora
  async function fetchGatewayConfig() {
    // Mantido silencioso para visual minimalista e limpo
  }

  // Gerenciamento de Passos / Telas
  function goToStep(stepName) {
    [stepForm, stepPending, stepSuccess, stepFailed].forEach(step => {
      step.classList.remove('active');
    });

    if (stepName === 'form') stepForm.classList.add('active');
    if (stepName === 'pending') stepPending.classList.add('active');
    if (stepName === 'success') stepSuccess.classList.add('active');
    if (stepName === 'failed') stepFailed.classList.add('active');
  }

  // Validação e detecção de operador móvel em Moçambique
  function detectOperator(rawNumber) {
    const clean = rawNumber.replace(/\D/g, '');
    const prefix = clean.slice(0, 2);

    if (prefix === '84' || prefix === '85') {
      return { operator: 'mpesa', name: 'M-Pesa', class: 'is-mpesa' };
    } else if (prefix === '86' || prefix === '87') {
      return { operator: 'emola', name: 'e-Mola', class: 'is-emola' };
    }
    return null;
  }

  // Máscara e evento de digitação do telefone
  phoneInput.addEventListener('input', (e) => {
    let val = e.target.value.replace(/\D/g, '');
    
    // Limita a 9 dígitos
    if (val.length > 9) val = val.slice(0, 9);

    // Formata como "84 123 4567"
    let formatted = '';
    if (val.length > 0) formatted = val.slice(0, 2);
    if (val.length >= 3) formatted += ' ' + val.slice(2, 5);
    if (val.length >= 6) formatted += ' ' + val.slice(5, 9);
    e.target.value = formatted;

    // Detecta operadora e sincroniza com o seletor visual
    const detection = detectOperator(val);
    if (detection) {
      operatorPill.className = `badge-operator ${detection.class}`;
      operatorPillText.textContent = detection.name;
      selectOperator(detection.operator);
    } else {
      operatorPill.className = 'badge-operator';
      operatorPillText.textContent = 'Auto';
    }

    clearError();
  });

  // Seletor manual de operadora
  function selectOperator(operator) {
    providerOptions.forEach(opt => {
      const radio = opt.querySelector('input[type="radio"]');
      if (opt.dataset.operator === operator) {
        opt.classList.add('active');
        radio.checked = true;
      } else {
        opt.classList.remove('active');
        radio.checked = false;
      }
    });
  }

  providerOptions.forEach(opt => {
    opt.addEventListener('click', () => {
      selectOperator(opt.dataset.operator);
    });
  });

  function showError(msg) {
    errorText.textContent = msg;
    formErrorMessage.style.display = 'flex';
  }

  function clearError() {
    formErrorMessage.style.display = 'none';
  }

  function setButtonLoading(loading) {
    if (btnSubmitPayment) btnSubmitPayment.disabled = loading;
    if (loading) {
      if (btnSpinner) btnSpinner.style.display = 'block';
      if (btnArrow) btnArrow.style.display = 'none';
      if (btnText) btnText.style.display = 'none';
    } else {
      if (btnSpinner) btnSpinner.style.display = 'none';
      if (btnArrow) btnArrow.style.display = 'block';
      if (btnText) btnText.style.display = 'inline';
    }
  }

  // Submissão do Formulário de Checkout
  checkoutForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();

    const rawPhone = phoneInput.value.replace(/\D/g, '');

    // Validações
    if (!rawPhone || rawPhone.length !== 9) {
      showError('Por favor, introduza um número de telemóvel válido com 9 dígitos (ex: 84 123 4567).');
      phoneInput.focus();
      return;
    }

    const firstTwo = rawPhone.slice(0, 2);
    if (!['84', '85', '86', '87'].includes(firstTwo)) {
      showError('O número deve pertencer a uma operadora válida (M-Pesa: 84/85 ou e-Mola: 86/87).');
      phoneInput.focus();
      return;
    }

    setButtonLoading(true);

    try {
      const payload = {
        phone: rawPhone,
        amount: checkoutConfig.amount,
        currency: checkoutConfig.currency,
        reference: checkoutConfig.reference,
        description: checkoutConfig.description,
        productId: checkoutConfig.productId || undefined,
        customer: {
          name: customerNameInput?.value?.trim() || undefined,
          email: customerEmailInput?.value?.trim() || undefined
        }
      };

      const response = await fetch('/api/payments/c2b', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok) {
        const errorMsg = data.error?.message || 'Falha ao iniciar cobrança. Tente novamente.';
        showError(errorMsg);
        setButtonLoading(false);
        return;
      }

      // Cobrança iniciada com sucesso (status: 'pending')
      activePaymentId = data.id;
      pendingPhoneNumber.textContent = `+258 ${rawPhone.slice(0, 2)} ${rawPhone.slice(2, 5)} ${rawPhone.slice(5)}`;
      
      goToStep('pending');
      startPollingAndCountdown();

    } catch (err) {
      console.error('Erro na requisição C2B:', err);
      showError('Não foi possível comunicar com o servidor. Verifique a ligação de rede.');
    } finally {
      setButtonLoading(false);
    }
  });

  // Polling e Contagem Regressiva
  function startPollingAndCountdown() {
    remainingSeconds = TOTAL_COUNTDOWN_SECONDS;
    updateCountdownUI();

    // Inicia cronômetro regressivo
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
      remainingSeconds--;
      updateCountdownUI();

      if (remainingSeconds <= 0) {
        stopTimers();
        showPaymentFailed('Tempo limite esgotado. A autorização do débito não foi concluída a tempo no telemóvel.');
      }
    }, 1000);

    // Inicia verificação periódica do status na API da Kivora
    if (pollingInterval) clearInterval(pollingInterval);
    checkPaymentStatus(); // primeira checagem imediata
    pollingInterval = setInterval(checkPaymentStatus, 2500);
  }

  function updateCountdownUI() {
    const mins = Math.floor(remainingSeconds / 60);
    const secs = remainingSeconds % 60;
    countdownTimer.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    
    const percentage = (remainingSeconds / TOTAL_COUNTDOWN_SECONDS) * 100;
    countdownProgress.style.width = `${percentage}%`;
  }

  async function checkPaymentStatus() {
    if (!activePaymentId) return;

    try {
      const res = await fetch(`/api/payments/c2b/${encodeURIComponent(activePaymentId)}`);
      if (!res.ok) return;

      const payment = await res.json();
      console.log('Status da cobrança Kivora:', payment.status);

      if (payment.status === 'paid' || payment.status === 'completed') {
        stopTimers();
        showPaymentSuccess(payment);
      } else if (payment.status === 'failed' || payment.status === 'cancelled') {
        stopTimers();
        const reason = payment.failureReason === 'insufficient_funds' 
          ? 'Saldo insuficiente na sua carteira móvel para liquidar o valor.'
          : 'A transação foi recusada ou cancelada no telemóvel.';
        showPaymentFailed(reason);
      }
    } catch (e) {
      console.warn('Erro ao verificar status:', e);
    }
  }

  function stopTimers() {
    if (pollingInterval) clearInterval(pollingInterval);
    if (countdownInterval) clearInterval(countdownInterval);
    pollingInterval = null;
    countdownInterval = null;
  }

  // Exibe tela de Sucesso
  function showPaymentSuccess(payment) {
    receiptId.textContent = payment.id || activePaymentId;
    receiptRef.textContent = payment.reference || checkoutConfig.reference;
    receiptPhone.textContent = `+258 ${payment.phone || phoneInput.value.replace(/\D/g, '')}`;
    receiptAmount.textContent = `${formatMoney(payment.amount || checkoutConfig.amount)} ${payment.currency || 'MZN'}`;
    
    const now = new Date();
    receiptDate.textContent = now.toLocaleString('pt-MZ', { 
      dateStyle: 'short', 
      timeStyle: 'medium' 
    });

    // Se houver entrega de infoproduto vinculada
    const deliveryCard = document.getElementById('productDeliveryCard');
    if (payment.delivery && deliveryCard) {
      const deliveryTitle = document.getElementById('deliveryTitle');
      const deliveryMessage = document.getElementById('deliveryMessage');
      const btnAccessProduct = document.getElementById('btnAccessProduct');
      const deliveryBtnText = document.getElementById('deliveryBtnText');

      if (deliveryTitle && payment.delivery.productName) {
        deliveryTitle.textContent = payment.delivery.productName;
      }
      if (deliveryMessage && payment.delivery.deliveryMessage) {
        deliveryMessage.textContent = payment.delivery.deliveryMessage;
      }
      if (btnAccessProduct && payment.delivery.deliveryUrl) {
        btnAccessProduct.href = payment.delivery.deliveryUrl;
      }
      if (deliveryBtnText) {
        deliveryBtnText.textContent = payment.delivery.deliveryType === 'download' 
          ? 'Descarregar Arquivo' 
          : 'Aceder Conteúdo / Grupo VIP';
      }
      deliveryCard.style.display = 'block';
    } else if (deliveryCard) {
      deliveryCard.style.display = 'none';
    }

    goToStep('success');
  }

  // Exibe tela de Falha
  function showPaymentFailed(reason) {
    failedReasonText.textContent = reason;
    goToStep('failed');
  }

  // Ações de botões
  btnCheckStatusNow.addEventListener('click', () => {
    pollingStatusText.textContent = 'A verificar autorização com o provedor...';
    checkPaymentStatus();
  });

  btnCancelPayment.addEventListener('click', () => {
    if (confirm('Deseja realmente cancelar este pagamento e tentar com outro número?')) {
      stopTimers();
      goToStep('form');
    }
  });

  btnPrintReceipt.addEventListener('click', () => {
    window.print();
  });

  btnNewPayment.addEventListener('click', () => {
    // Gera nova referência para novo pagamento
    checkoutConfig.reference = `ORD-${Math.floor(1000 + Math.random() * 9000)}`;
    displayReference.textContent = checkoutConfig.reference;
    phoneInput.value = '';
    goToStep('form');
  });

  btnTryAgain.addEventListener('click', () => {
    goToStep('form');
  });

  // Inicia aplicação
  initCheckoutView();
});

