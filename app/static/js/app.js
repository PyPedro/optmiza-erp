Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = '#2a374a';

const escapeHTML = (str) => {
    if (str === null || str === undefined) return '';
    if (typeof str !== 'string') str = String(str);
    return str.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
};

const escapeAttribute = (str) => escapeHTML(str ?? '');

function mostrarAviso(mensagem, tipo = 'error') {
    let container = document.getElementById('avisos-app');
    if (!container) {
        container = document.createElement('div');
        container.id = 'avisos-app';
        document.body.appendChild(container);
    }
    const aviso = document.createElement('div');
    aviso.className = `aviso-app ${tipo}`;
    aviso.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
    aviso.textContent = mensagem;
    container.appendChild(aviso);
    requestAnimationFrame(() => aviso.classList.add('visivel'));
    setTimeout(() => { aviso.classList.remove('visivel'); setTimeout(() => aviso.remove(), 220); }, tipo === 'error' ? 6000 : 3500);
}

function mostrarNotificacaoSolicitacao(notificacao) {
    let container = document.getElementById('avisos-app');
    if (!container) {
        container = document.createElement('div');
        container.id = 'avisos-app';
        document.body.appendChild(container);
    }
    const aviso = document.createElement('button');
    aviso.type = 'button';
    aviso.className = `aviso-app aviso-solicitacao ${notificacao.tipo === 'agenda' ? 'aviso-agenda' : ''} visivel`;
    aviso.setAttribute('role', 'alert');
    aviso.innerHTML = `<strong>🔔 ${escapeHTML(notificacao.titulo)}</strong><span>${escapeHTML(notificacao.mensagem)}</span><small>Clique para abrir a mensagem</small>`;
    aviso.onclick = async () => { aviso.remove(); if (notificacao.tipo === 'agenda') await abrirCartaoMensagemAgenda(notificacao.referencia_id); else { switchView('solicitacoes', document.getElementById('nav-solicitacoes')); } };
    container.appendChild(aviso);
    setTimeout(() => { aviso.classList.remove('visivel'); setTimeout(() => aviso.remove(), 220); }, 12000);
}

async function verificarNotificacoes() {
    if (!currentUser) return;
    try {
        const resposta = await fetch('/api/v1/notificacoes', { cache: 'no-store' });
        if (!resposta.ok) return;
        const notificacoes = await resposta.json();
        for (const notificacao of notificacoes.reverse()) {
            mostrarNotificacaoSolicitacao(notificacao);
            fetch(`/api/v1/notificacoes/${notificacao.id}/ler`, { method: 'PUT' }).catch(() => {});
        }
    } catch (erro) { console.error('Erro ao verificar notificações:', erro); }
}

window.alert = mensagem => mostrarAviso(mensagem, 'error');

function nomeItemCompleto(valor) {
    const texto = String(valor || '').trim();
    if (!texto) return 'Item não informado';
    const termo = texto.toLowerCase();
    const itemCadastrado = itens.find(item => String(item.codigo || '').toLowerCase() === termo || String(item.descricao || '').toLowerCase() === termo)
        || itens.find(item => String(item.descricao || '').toLowerCase().includes(termo));
    return itemCadastrado ? itemCadastrado.descricao : texto;
}

let solicitacoes = []; let pedidos = []; let pedidosComerciais = []; let fornecedores = []; let materiaisMRP = []; let rotasData = []; let listaUsuarios = []; let itens = [];
const rotasSelecionadas = new Set();
const ENDERECO_BASE_ROTA = 'Av. João Soares Machado, 542 - Distrito Industrial II, Caruaru - PE, 55040-145';
let pageSC = 1; let hasNextSC = false; let loadingSC = false;
let pagePO = 1; let hasNextPO = false; let loadingPO = false;
let currentScDbId = null; let currentDetalhes = { id: null, tipo: null, db_id: null, etiquetas: [] };
let solicitacaoEnviando = false;
let cotacaoEnviando = false;
let currentFornecedorOcorrenciaId = null;
let fornecedorExpandidoId = null;
let paginaFornecedores = 1;
const fornecedoresPorPagina = 25;
let filtroPrevisaoAtual = 'hoje';
let mrpRenderLimit = 15;
let currentUser = null;
let niveisAcesso = [];
let paginasAcesso = [];
let dataCalendarioAtual = new Date(); 
let currentMrpIdParaSC = null;
const materiaisCalculadoraSelecionados = new Set();
let itemSuggestionIndex = -1;
let mrpSuggestionIndex = -1;
let poItemSuggestionIndex = -1;
let poFornecedorSuggestionIndex = -1;
let fornecedorTabelaSuggestionIndex = -1;
let itensCarregados = false;
let carregamentoItens = null;
let limiteRenderizacaoItens = 100;
let tarefasAgenda = []; let usuariosAgenda = [];
let intervaloTempoReal = null;
let atualizacaoTempoRealEmLote = false;
let assinaturaKanban = '';
let retornarAoPOAposCadastroItem = false;

const dadosKPI = { otif: 91.5, leadTimeMedio: null, leadTimeInternoMedio: null, taxaEmergencial: 0 };
let chartStatusInstance = null; let chartGastosInstance = null;

// === TEMA E ACESSO ===
function loadTheme() { const savedTheme = localStorage.getItem("theme") || "light"; document.documentElement.setAttribute("data-theme", savedTheme); updateThemeUI(savedTheme); }
function toggleTheme() { const currentTheme = document.documentElement.getAttribute("data-theme"); let targetTheme = (currentTheme === "light" || !currentTheme) ? "dark" : "light"; document.documentElement.setAttribute("data-theme", targetTheme); localStorage.setItem("theme", targetTheme); updateThemeUI(targetTheme); }
function updateThemeUI(theme) { const icon = document.getElementById("theme-icon"); const text = document.getElementById("theme-text"); if (theme === "dark") { icon.innerText = "☀️"; text.innerText = "Modo Claro"; Chart.defaults.color = '#94a3b8'; Chart.defaults.borderColor = '#2a374a'; } else { icon.innerText = "🌙"; text.innerText = "Modo Escuro"; Chart.defaults.color = '#475569'; Chart.defaults.borderColor = '#e2e8f0'; } if (solicitacoes.length > 0) renderCharts(); }
function toggleMobileMenu() { const sidebar = document.querySelector('.sidebar'); const toggle = document.querySelector('.mobile-menu-toggle'); if (!sidebar || !toggle) return; const aberto = sidebar.classList.toggle('mobile-menu-open'); toggle.setAttribute('aria-expanded', String(aberto)); toggle.querySelector('.mobile-menu-icon').textContent = aberto ? '×' : '☰'; }
function toggleSidebar() { const sidebar = document.querySelector('.sidebar'); const toggle = document.querySelector('.sidebar-collapse-toggle'); if (!sidebar || !toggle) return; const recolhida = sidebar.classList.toggle('sidebar-collapsed'); document.body.classList.toggle('sidebar-recolhida', recolhida); toggle.setAttribute('aria-label', recolhida ? 'Expandir menu' : 'Recolher menu'); toggle.setAttribute('title', recolhida ? 'Expandir menu' : 'Recolher menu'); toggle.querySelector('[aria-hidden="true"]').textContent = recolhida ? '›' : '‹'; localStorage.setItem('sidebar-collapsed', String(recolhida)); }
function carregarEstadoSidebar() { if (window.innerWidth <= 768) return; const recolhida = localStorage.getItem('sidebar-collapsed') === 'true'; if (!recolhida) return; const sidebar = document.querySelector('.sidebar'); const toggle = document.querySelector('.sidebar-collapse-toggle'); if (!sidebar || !toggle) return; sidebar.classList.add('sidebar-collapsed'); document.body.classList.add('sidebar-recolhida'); toggle.setAttribute('aria-label', 'Expandir menu'); toggle.setAttribute('title', 'Expandir menu'); toggle.querySelector('[aria-hidden="true"]').textContent = '›'; }
function toggleAgenda() {
    const agenda = document.getElementById('agenda-card');
    const botao = document.querySelector('.agenda-sidebar-toggle');
    if (!agenda) return;
    const aberta = agenda.classList.toggle('agenda-open');
    agenda.setAttribute('aria-hidden', String(!aberta));
    if (botao) {
        botao.setAttribute('aria-expanded', String(aberta));
        botao.setAttribute('aria-label', aberta ? 'Fechar agenda' : 'Abrir agenda');
        botao.setAttribute('title', aberta ? 'Fechar agenda' : 'Abrir agenda');
    }
}

async function carregarUsuarioLogado() {
    try { const res = await fetch('/api/v1/me'); if (res.ok) { currentUser = await res.json(); aplicarControleDeAcesso(currentUser.perfil, currentUser.permissoes); verificarNotificacoes(); setInterval(verificarNotificacoes, 1500); iniciarAtualizacaoTempoReal(); } } 
    catch (e) { console.error("Erro ao carregar usuário:", e); }
}

async function carregarNiveisAcesso() {
    if (!currentUser || currentUser.perfil !== 'admin') return;
    try {
        const resposta = await fetch('/api/v1/niveis');
        if (!resposta.ok) return;
        const dados = await resposta.json();
        niveisAcesso = dados.niveis || [];
        paginasAcesso = dados.paginas || [];
        preencherSelectNiveis();
    } catch (erro) { console.error('Erro ao carregar níveis:', erro); }
}

function preencherSelectNiveis() {
    const select = document.getElementById('usuario_perfil');
    if (!select) return;
    select.innerHTML = niveisAcesso.map(nivel => `<option value="${escapeAttribute(nivel.nome)}">${escapeHTML(nivel.nome)}</option>`).join('');
}

function iniciarAtualizacaoTempoReal() {
    if (intervaloTempoReal) return;
    intervaloTempoReal = setInterval(async () => {
        if (!currentUser) return;
        atualizacaoTempoRealEmLote = true;
        try {
            await Promise.allSettled([
                carregarSolicitacoes(true),
                carregarPedidos(true),
                carregarKPIs(),
                carregarRotas(),
                verificarNotificacoes()
            ]);
        } catch (erro) {
            console.error('Erro ao atualizar dados em tempo real:', erro);
        } finally {
            atualizacaoTempoRealEmLote = false;
            renderTables();
        }
    }, 3000);
}

function aplicarControleDeAcesso(perfil, permissoesUsuario = null) {
    const paginasPermitidas = permissoesUsuario || niveisAcesso.find(nivel => nivel.nome === perfil)?.permissoes || ['dashboard', 'solicitacoes'];
    const abasPermitidas = paginasPermitidas.map(pagina => `nav-${pagina}`);
    const todosOsItensMenu = ['nav-dashboard', 'nav-solicitacoes', 'nav-comercial', 'nav-itens', 'nav-pedidos', 'nav-fornecedores', 'nav-mrp', 'nav-rotas', 'nav-precos', 'nav-usuarios'];
    
    todosOsItensMenu.forEach(menuId => { 
        const el = document.getElementById(menuId); 
        if (el) el.style.display = abasPermitidas.includes(menuId) ? 'block' : 'none'; 
    });

    const isEstoque = (perfil === 'estoque');
    document.body.classList.toggle('modo-estoque', isEstoque);
    
    // O dashboard do estoque exibe somente previsão de chegada e Kanban.
    const blocosOcultosEstoque = ['dashboard-tools', 'agenda-card', 'dash-kpis', 'dash-chart-status', 'dash-chart-gastos', 'dash-rotas'];
    blocosOcultosEstoque.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = isEstoque ? 'none' : ''; 
    });

    // Oculta o título e botão de nova SC do Dashboard para o Estoque
    const dashHeader = document.querySelector('#view-dashboard header');
    if (dashHeader) dashHeader.style.display = isEstoque ? 'none' : 'flex';

    // Mantém a previsão no formato resumido do dashboard para o Estoque.
    const dashPrevisao = document.getElementById('dash-previsao');
    if (dashPrevisao) {
        dashPrevisao.style.height = isEstoque ? '260px' : '';
    }
}

// === CARREGAMENTO (APIs) ===
async function carregarSolicitacoes(reset = false) { if (loadingSC) return; loadingSC = true; if (reset) { pageSC = 1; solicitacoes = []; } try { const r = await fetch(`/api/v1/solicitacoes?page=${pageSC}&per_page=100`, { cache: 'no-store' }); if (r.ok) { const data = await r.json(); const podeVerTodas = currentUser && ['comprador', 'admin', 'gerente'].includes(currentUser.perfil); const itensVisiveis = podeVerTodas ? data.items : data.items.filter(item => item.usuario_id === currentUser?.id); solicitacoes = reset ? itensVisiveis : solicitacoes.concat(itensVisiveis); hasNextSC = data.has_next; if (hasNextSC) pageSC++; renderTables(); } } catch (e) { console.error(e); } finally { loadingSC = false; } }
async function carregarPedidos(reset = false) { if (loadingPO) return; loadingPO = true; if (reset) { pagePO = 1; pedidos = []; } try { const r = await fetch(`/api/v1/pedidos?page=${pagePO}&per_page=100`); if (r.ok) { const data = await r.json(); pedidos = reset ? data.items : pedidos.concat(data.items); hasNextPO = data.has_next; if (hasNextPO) pagePO++; renderTables(); } } catch (e) { console.error(e); } finally { loadingPO = false; } }
async function carregarFornecedores() { try { const r = await fetch('/api/v1/fornecedores'); if (r.ok) { fornecedores = await r.json(); paginaFornecedores = 1; fornecedorExpandidoId = null; renderTables(); } } catch (e) { console.error(e); } }
async function carregarPedidosComerciais() { if (!currentUser || !['comercial', 'admin'].includes(currentUser.perfil)) return; try { const r = await fetch('/api/v1/comercial/pedidos', { cache: 'no-store' }); if (r.ok) { pedidosComerciais = await r.json(); renderPedidosComerciais(); } } catch (erro) { console.error(erro); } }
function filtrarPedidosComerciais() { renderPedidosComerciais(); }
function abrirPreviewImagemComercial(url) {
    if (!url) return;
    const modal = document.getElementById('modalPreviewImagemComercial');
    const imagem = document.getElementById('modalPreviewImagemComercialImg');
    if (!modal || !imagem) return;
    imagem.src = url;
    imagem.alt = 'Visualização da imagem do pedido comercial';
    modal.classList.add('active');
}
function fecharPreviewImagemComercial() {
    const modal = document.getElementById('modalPreviewImagemComercial');
    const imagem = document.getElementById('modalPreviewImagemComercialImg');
    if (modal) modal.classList.remove('active');
    if (imagem) imagem.removeAttribute('src');
}
function togglePedidoComercial(id) {
    const detalhes = document.getElementById(`pedido-comercial-detalhes-${id}`);
    if (!detalhes) return;
    const isOpen = detalhes.style.display !== 'none';
    detalhes.style.display = isOpen ? 'none' : 'table-row';
    const botao = document.getElementById(`pedido-comercial-toggle-${id}`);
    if (botao) {
        botao.textContent = isOpen ? '▸' : '▾';
    }
}
async function alternarInclusaoSap(id, incluido) {
    const mensagem = incluido ? 'Desmarcar este pedido como incluído no SAP?' : 'Confirmar que este pedido foi incluído no SAP?';
    if (!await confirmarAcao(mensagem)) return;
    try {
        const resposta = await fetch(`/api/v1/comercial/pedidos/${id}/sap`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ incluido_no_sap: !incluido }) });
        const resultado = await resposta.json();
        if (!resposta.ok) { alert(resultado.erro || 'Não foi possível atualizar a confirmação SAP.'); return; }
        const indice = pedidosComerciais.findIndex(pedido => pedido.id === id);
        if (indice >= 0) pedidosComerciais[indice] = resultado;
        renderPedidosComerciais();
        mostrarAviso(resultado.incluido_no_sap ? 'Pedido marcado como incluído no SAP.' : 'Confirmação SAP removida.', 'success');
    } catch (erro) { console.error(erro); alert('Não foi possível conectar ao servidor.'); }
}
function renderPedidosComerciais() { const tbody = document.getElementById('comercial-table-body'); if (!tbody) return; const termo = (document.getElementById('search-comercial')?.value || '').toLowerCase(); const lista = pedidosComerciais.filter(pedido => [pedido.cliente, pedido.pedido_sap, pedido.produto, ...(pedido.itens || []).map(item => item.produto)].some(valor => String(valor || '').toLowerCase().includes(termo))); tbody.innerHTML = lista.length ? lista.map(pedido => { const itens = pedido.itens || []; const totalQuantidade = itens.reduce((total, item) => total + Number(item.quantidade || 0), 0); const valorPedido = itens.reduce((total, item) => total + Number(item.valor || 0), 0) || Number(pedido.valor_total || 0); const sapConfirmado = Boolean(pedido.incluido_no_sap); const produtosHtml = itens.length ? itens.map(item => `
        <div class="pedido-comercial-item" style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:8px 10px; border:1px solid var(--border-color); border-radius:6px; background:var(--bg-color);">
            <div style="display:flex; flex-direction:column; gap:4px; min-width:0; flex:1;">
                <strong style="color:var(--text-title);">${escapeHTML(item.produto || '-')}</strong>
                <span style="color:var(--text-body); font-size:.77rem;">Quantidade: ${escapeHTML(Number(item.quantidade || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 }))} • Valor: ${escapeHTML(item.valor_formatado || formatarMoeda(Number(item.valor || 0)))}</span>
                ${item.observacao ? `<span style="color:var(--text-body); font-size:.75rem; white-space:pre-wrap;">Obs.: ${escapeHTML(item.observacao)}</span>` : ''}
            </div>
            <div style="flex-shrink:0;">
                ${item.imagem_url ? `<img src="${escapeHTML(item.imagem_url)}" alt="Foto de ${escapeHTML(item.produto || 'produto')}" class="comercial-foto-miniatura" style="cursor:pointer;" onclick="event.stopPropagation(); abrirPreviewImagemComercial('${escapeHTML(item.imagem_url)}')">` : '<span style="font-size:.7rem;color:var(--text-body);">Sem foto</span>'}
            </div>
        </div>`).join('') : '<span style="color:var(--text-body); font-size:.78rem;">Nenhum produto</span>'; const resumoTexto = pedido.resumo || pedido.observacoes || 'Pedido comercial'; return `
        <tr class="pedido-comercial-resumo" style="cursor:pointer;" data-id="${pedido.id}" onclick="togglePedidoComercial(${pedido.id})">
            <td><button type="button" id="pedido-comercial-toggle-${pedido.id}" class="btn btn-link" style="padding:0; font-size:1rem; color:var(--primary-color); border:0; background:transparent; cursor:pointer;">▸</button> <strong>${escapeHTML(pedido.cliente || '-')}</strong></td>
            <td>${escapeHTML(pedido.data_pedido || '-')}</td>
            <td>${escapeHTML(pedido.pedido_sap || '-')}</td>
            <td>${escapeHTML(itens.map(item => item.produto || '-').join(', ') || '-')}</td>
            <td>${escapeHTML(String(totalQuantidade || 0))}</td>
            <td><button type="button" class="btn sap-confirmacao${sapConfirmado ? ' confirmado' : ''}" aria-pressed="${sapConfirmado}" onclick="event.stopPropagation(); alternarInclusaoSap(${pedido.id}, ${sapConfirmado})" title="${sapConfirmado ? 'Pedido incluído no SAP. Clique para desfazer.' : 'Confirmar que o pedido foi incluído no SAP'}" aria-label="${sapConfirmado ? 'Pedido incluído no SAP. Clique para desfazer.' : 'Confirmar inclusão do pedido no SAP'}">✓</button></td>
            <td>${itens.some(item => item.imagem_url) ? `<img src="${escapeHTML(itens.find(item => item.imagem_url)?.imagem_url)}" alt="Foto do pedido" class="comercial-foto-miniatura" style="cursor:pointer;" onclick="event.stopPropagation(); abrirPreviewImagemComercial('${escapeHTML(itens.find(item => item.imagem_url)?.imagem_url)}')">` : '<span style="font-size:.7rem;color:var(--text-body);">-</span>'}</td>
            <td><div style="display:flex; gap:8px;"><button class="btn btn-outline" style="padding:4px 8px; font-size:.75rem;" onclick="event.stopPropagation(); editarPedidoComercial(${pedido.id})">Editar</button><button class="btn btn-outline" style="padding:4px 8px; font-size:.75rem; color:var(--danger-color);" onclick="event.stopPropagation(); excluirPedidoComercial(${pedido.id})">Excluir</button></div></td>
        </tr>
        <tr id="pedido-comercial-detalhes-${pedido.id}" style="display:none;">
            <td colspan="8" style="padding: 0 12px 12px; background: rgba(15, 23, 42, 0.02);">
                <div style="display:grid; gap:10px; padding:12px; border:1px solid var(--border-color); border-radius:8px; background:var(--surface-color);">
                    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap:10px;">
                        <div><strong style="display:block; color:var(--text-body); font-size:.7rem; text-transform:uppercase; letter-spacing:.04em;">Cliente</strong><span style="color:var(--text-title);">${escapeHTML(pedido.cliente || '-')}</span></div>
                        <div><strong style="display:block; color:var(--text-body); font-size:.7rem; text-transform:uppercase; letter-spacing:.04em;">Data</strong><span style="color:var(--text-title);">${escapeHTML(pedido.data_pedido || '-')}</span></div>
                        <div><strong style="display:block; color:var(--text-body); font-size:.7rem; text-transform:uppercase; letter-spacing:.04em;">SAP</strong><span style="color:var(--text-title);">${escapeHTML(pedido.pedido_sap || '-')}</span></div>
                        <div><strong style="display:block; color:var(--text-body); font-size:.7rem; text-transform:uppercase; letter-spacing:.04em;">Total</strong><span style="color:var(--text-title);">${escapeHTML(formatarMoeda(valorPedido))}</span></div>
                    </div>
                    <div style="display:grid; gap:8px;">${produtosHtml}</div>
                    <div style="display:grid; gap:4px;">
                        <strong style="display:block; color:var(--text-body); font-size:.7rem; text-transform:uppercase; letter-spacing:.04em;">Resumo</strong>
                        <span style="color:var(--text-title);">${escapeHTML(resumoTexto)}</span>
                    </div>
                    ${pedido.observacoes ? `<div style="display:grid; gap:4px;"><strong style="display:block; color:var(--text-body); font-size:.7rem; text-transform:uppercase; letter-spacing:.04em;">Observações</strong><span style="color:var(--text-title); white-space:pre-wrap;">${escapeHTML(pedido.observacoes)}</span></div>` : ''}
                </div>
            </td>
        </tr>
    `; }).join('') : '<tr><td colspan="7" style="text-align:center;">Nenhum pedido comercial encontrado.</td></tr>'; }
function atualizarResumoPedidoComercial() {
    const linhas = [...document.querySelectorAll('#comercial-itens-lista .comercial-item-row')];
    const totalPedido = linhas.reduce((soma, linha) => {
        const valorInput = linha.querySelector('input[name="valor"]');
        const quantidadeInput = linha.querySelector('input[name="quantidade"]');
        const valor = Number(String(valorInput?.value || '').replace('.', '').replace(',', '.')) || 0;
        const quantidade = Number(quantidadeInput?.value || 0) || 0;
        return soma + (valor * quantidade);
    }, 0);
    const campoValorTotal = document.getElementById('comercial_valor_total');
    if (campoValorTotal) campoValorTotal.value = formatarMoeda(totalPedido);
    const campoResumo = document.getElementById('comercial_resumo');
    if (campoResumo) {
        const resumoLinhas = linhas.map(linha => {
            const produto = linha.querySelector('input[name="produto"]')?.value?.trim() || 'Produto';
            const quantidade = Number(linha.querySelector('input[name="quantidade"]')?.value || 0) || 0;
            const valor = Number(String(linha.querySelector('input[name="valor"]')?.value || '').replace('.', '').replace(',', '.')) || 0;
            return `${produto} (${quantidade} un. - ${formatarMoeda(valor * quantidade)})`;
        });
        campoResumo.value = resumoLinhas.length ? `Resumo: ${resumoLinhas.join(' | ')}. Total geral: ${formatarMoeda(totalPedido)}` : 'Resumo: sem itens cadastrados.';
    }
}
function gerarLinhaProdutoComercial(item = null) {
    const idUnico = item?.id || `nova-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `
        <div class="comercial-item-row" data-item-id="${idUnico}" style="display:grid; grid-template-columns: minmax(0,1.5fr) minmax(110px,0.55fr) minmax(110px,0.7fr) minmax(0,1.2fr) minmax(120px,0.9fr) auto; gap:10px; align-items:end; margin-bottom:10px; padding:10px; border:1px solid var(--border-color); border-radius:8px; background:var(--bg-color);">
            <div class="form-group">
                <label>Produto</label>
                <input name="produto" value="${escapeAttribute(item?.produto || '')}" maxlength="150" required>
            </div>
            <div class="form-group">
                <label>Quantidade</label>
                <input type="number" name="quantidade" min="0.01" step="any" value="${escapeAttribute(item?.quantidade != null ? String(item.quantidade) : '')}" required>
            </div>
            <div class="form-group">
                <label>Valor</label>
                <input type="text" name="valor" inputmode="decimal" value="${escapeAttribute(item?.valor != null ? String(item.valor) : '')}" placeholder="0,00" required>
            </div>
            <div class="form-group">
                <label>Observação</label>
                <textarea name="observacao" rows="2" maxlength="1000" placeholder="Detalhes do item...">${escapeHTML(item?.observacao || '')}</textarea>
            </div>
            <div class="form-group">
                <label>Foto</label>
                <div class="comercial-imagem-drop" tabindex="0" role="button" aria-label="Área para arrastar ou colar imagem do produto">
                    <input type="file" name="imagem" accept="image/png,image/jpeg,image/webp" hidden>
                    <img class="comercial-imagem-preview" alt="Preview da imagem" hidden>
                    <span class="comercial-imagem-placeholder">Arraste a imagem aqui<br>ou cole o print</span>
                    <span class="comercial-imagem-nome">Sem imagem</span>
                    ${item?.imagem_url ? `<a href="${escapeAttribute(item.imagem_url)}" target="_blank" rel="noreferrer" class="comercial-imagem-link">Ver foto atual</a>` : ''}
                </div>
            </div>
            <button type="button" class="btn btn-outline" style="padding:6px 10px;" onclick="this.closest('.comercial-item-row').remove(); atualizarResumoPedidoComercial();">Remover</button>
        </div>
    `;
}
function atualizarPreviewImagemComercialNaLinha(linha, arquivo) {
    const input = linha.querySelector('input[name="imagem"]');
    const preview = linha.querySelector('.comercial-imagem-preview');
    const placeholder = linha.querySelector('.comercial-imagem-placeholder');
    const nome = linha.querySelector('.comercial-imagem-nome');
    if (!input || !preview || !placeholder || !nome) return;
    if (!arquivo) {
        preview.hidden = true;
        preview.removeAttribute('src');
        placeholder.hidden = false;
        nome.textContent = 'Sem imagem';
        return;
    }
    const url = URL.createObjectURL(arquivo);
    preview.src = url;
    preview.hidden = false;
    placeholder.hidden = true;
    nome.textContent = arquivo.name || 'Imagem anexada';
}
function configurarDropImagemComercialNaLinha(linha) {
    const input = linha.querySelector('input[name="imagem"]');
    const dropZone = linha.querySelector('.comercial-imagem-drop');
    if (!input || !dropZone) return;
    const aplicarArquivo = (arquivo) => {
        if (!arquivo || !arquivo.type?.startsWith('image/')) return;
        const transferencia = new DataTransfer();
        transferencia.items.add(arquivo);
        input.files = transferencia.files;
        atualizarPreviewImagemComercialNaLinha(linha, arquivo);
    };
    input.addEventListener('change', (event) => {
        const arquivo = event.target.files?.[0];
        atualizarPreviewImagemComercialNaLinha(linha, arquivo);
    });
    dropZone.addEventListener('click', (event) => {
        if (event.target.closest('a')) return;
        input.click();
    });
    dropZone.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            input.click();
        }
    });
    dropZone.addEventListener('dragover', (event) => {
        event.preventDefault();
        dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });
    dropZone.addEventListener('drop', (event) => {
        event.preventDefault();
        dropZone.classList.remove('dragover');
        const arquivo = event.dataTransfer?.files?.[0];
        aplicarArquivo(arquivo);
    });
    linha.addEventListener('paste', (event) => {
        const item = [...(event.clipboardData?.items || [])].find(entrada => entrada.type.startsWith('image/'));
        if (!item) return;
        event.preventDefault();
        aplicarArquivo(item.getAsFile());
    });
}
function adicionarLinhaProdutoComercial(item = null) {
    const container = document.getElementById('comercial-itens-lista');
    if (!container) return;
    container.insertAdjacentHTML('beforeend', gerarLinhaProdutoComercial(item));
    const linha = container.lastElementChild;
    if (linha) {
        configurarDropImagemComercialNaLinha(linha);
        linha.querySelectorAll('input, textarea').forEach(campo => campo.addEventListener('input', atualizarResumoPedidoComercial));
        atualizarResumoPedidoComercial();
    }
}
function resetarFormularioPedidoComercial() {
    const form = document.getElementById('formPedidoComercial');
    if (form) form.reset();
    const pedidoId = document.getElementById('comercial_pedido_id');
    if (pedidoId) pedidoId.value = '';
    const container = document.getElementById('comercial-itens-lista');
    if (container) container.innerHTML = '';
    adicionarLinhaProdutoComercial();
    atualizarResumoPedidoComercial();
}
function abrirModalPedidoComercial() {
    resetarFormularioPedidoComercial();
    const titulo = document.getElementById('tituloPedidoComercial');
    if (titulo) titulo.textContent = 'Novo pedido comercial';
    const dataCampo = document.getElementById('comercial_data');
    if (dataCampo) dataCampo.value = dataAgendaHoje();
    const modal = document.getElementById('modalPedidoComercial');
    if (modal) modal.classList.add('active');
}
function fecharModalPedidoComercial() {
    const modal = document.getElementById('modalPedidoComercial');
    if (modal) modal.classList.remove('active');
}
async function editarPedidoComercial(id) {
    const pedido = pedidosComerciais.find(item => item.id === id);
    if (!pedido) return;
    const form = document.getElementById('formPedidoComercial');
    if (!form) return;
    const titulo = document.getElementById('tituloPedidoComercial');
    if (titulo) titulo.textContent = 'Editar pedido comercial';
    const pedidoId = document.getElementById('comercial_pedido_id');
    if (pedidoId) pedidoId.value = pedido.id;
    const cliente = document.getElementById('comercial_cliente');
    if (cliente) cliente.value = pedido.cliente || '';
    const dataCampo = document.getElementById('comercial_data');
    if (dataCampo) dataCampo.value = pedido.data_pedido ? pedido.data_pedido.split('/').reverse().join('-') : dataAgendaHoje();
    const sap = document.getElementById('comercial_sap');
    if (sap) sap.value = pedido.pedido_sap || '';
    const observacoes = document.getElementById('comercial_observacoes');
    if (observacoes) observacoes.value = pedido.observacoes || '';
    const resumo = document.getElementById('comercial_resumo');
    if (resumo) resumo.value = pedido.resumo || '';
    const valorTotal = document.getElementById('comercial_valor_total');
    if (valorTotal) valorTotal.value = formatarMoeda(Number(pedido.valor_total || 0));
    const container = document.getElementById('comercial-itens-lista');
    if (container) {
        container.innerHTML = '';
        (pedido.itens || []).forEach(item => adicionarLinhaProdutoComercial(item));
        if (!(pedido.itens || []).length) adicionarLinhaProdutoComercial();
    }
    atualizarResumoPedidoComercial();
    const modal = document.getElementById('modalPedidoComercial');
    if (modal) modal.classList.add('active');
}
async function excluirPedidoComercial(id) {
    if (!confirm('Confirma excluir este pedido comercial?')) return;
    try {
        const resposta = await fetch(`/api/v1/comercial/pedidos/${id}`, { method: 'DELETE' });
        const resultado = await resposta.json().catch(() => ({}));
        if (!resposta.ok) { alert(resultado.erro || 'Não foi possível excluir o pedido.'); return; }
        await carregarPedidosComerciais();
        mostrarAviso('Pedido comercial excluído.', 'success');
    } catch (erro) {
        console.error(erro);
        alert('Não foi possível excluir o pedido.');
    }
}
async function salvarPedidoComercial(event) {
    event.preventDefault();
    const form = event.target;
    const idCampo = document.getElementById('comercial_pedido_id');
    const id = idCampo ? idCampo.value : '';
    const dados = new FormData();
    const cliente = document.getElementById('comercial_cliente');
    const dataPedido = document.getElementById('comercial_data');
    const pedidoSap = document.getElementById('comercial_sap');
    const observacoes = document.getElementById('comercial_observacoes');
    const resumo = document.getElementById('comercial_resumo');
    const valorTotal = document.getElementById('comercial_valor_total');
    if (cliente) dados.append('cliente', cliente.value);
    if (dataPedido) dados.append('data_pedido', dataPedido.value);
    if (pedidoSap) dados.append('pedido_sap', pedidoSap.value);
    if (observacoes) dados.append('observacoes', observacoes.value.trim());
    if (resumo) dados.append('resumo', resumo.value.trim());

    const containerProdutos = document.getElementById('comercial-itens-lista');
    const itensValidos = [];

    if (containerProdutos) {
        const linhas = [...containerProdutos.querySelectorAll('.comercial-item-row')];
        if (!linhas.length) { alert('Adicione pelo menos um produto ao pedido.'); return; }
        linhas.forEach((linha, indice) => {
            const campoProduto = linha.querySelector('input[name="produto"]');
            const campoQuantidade = linha.querySelector('input[name="quantidade"]');
            const campoValor = linha.querySelector('input[name="valor"]');
            const campoObservacao = linha.querySelector('textarea[name="observacao"]');
            const campoImagem = linha.querySelector('input[name="imagem"]');
            const produto = campoProduto?.value?.trim() || '';
            const quantidade = campoQuantidade?.value?.trim() || '';
            const valor = campoValor?.value?.trim() || '';
            const observacao = campoObservacao?.value?.trim() || '';
            const imagem = campoImagem?.files?.[0];
            if (!produto || !quantidade || !valor) {
                throw new Error(`Preencha produto, quantidade e valor da linha ${indice + 1}.`);
            }
            itensValidos.push({ produto, quantidade, valor, observacao, imagem });
        });
    } else {
        const produtoLegacy = document.getElementById('comercial_produto');
        const quantidadeLegacy = document.getElementById('comercial_quantidade');
        const valorLegacy = document.getElementById('comercial_valor');
        const observacaoLegacy = document.getElementById('comercial_observacao');
        const imagemLegacy = document.getElementById('comercial_imagem')?.files?.[0];
        const produto = produtoLegacy?.value?.trim() || '';
        const quantidade = quantidadeLegacy?.value?.trim() || '';
        const valor = valorLegacy?.value?.trim() || '';
        const observacao = observacaoLegacy?.value?.trim() || '';
        if (!produto || !quantidade || !valor) { alert('Preencha produto, quantidade e valor do pedido.'); return; }
        itensValidos.push({ produto, quantidade, valor, observacao, imagem: imagemLegacy || null });
    }

    if (!itensValidos.length) { alert('Informe ao menos um produto.'); return; }
    const totalPedido = itensValidos.reduce((soma, item) => {
        const valorNumerico = Number(String(item.valor).replace('.', '').replace(',', '.')) || 0;
        const quantidadeNumerica = Number(item.quantidade) || 0;
        return soma + (valorNumerico * quantidadeNumerica);
    }, 0);
    if (valorTotal) dados.append('valor_total', String(totalPedido.toFixed(2)).replace('.', ','));
    itensValidos.forEach((item, indice) => {
        dados.append(`itens[${indice}][produto]`, item.produto);
        dados.append(`itens[${indice}][quantidade]`, item.quantidade);
        dados.append(`itens[${indice}][valor]`, item.valor);
        if (item.observacao) dados.append(`itens[${indice}][observacao]`, item.observacao);
        if (item.imagem) dados.append(`itens[${indice}][imagem]`, item.imagem);
    });

    const botao = form.querySelector('button[type="submit"]');
    if (botao) { botao.disabled = true; botao.textContent = 'Salvando...'; }

    try {
        const url = id ? `/api/v1/comercial/pedidos/${id}` : '/api/v1/comercial/pedidos';
        const metodo = id ? 'PUT' : 'POST';
        const resposta = await fetch(url, { method: metodo, body: dados });
        const texto = await resposta.text();
        let resultado = {};
        try { resultado = texto ? JSON.parse(texto) : {}; } catch (erroParse) { resultado = { erro: `Servidor respondeu HTTP ${resposta.status}. Reinicie o sistema e tente novamente.` }; }
        if (!resposta.ok) { alert(resultado.erro || 'Não foi possível salvar o pedido.'); return; }
        fecharModalPedidoComercial();
        await carregarPedidosComerciais();
        mostrarAviso('Pedido comercial salvo com sucesso.', 'success');
    } catch (erro) {
        console.error(erro);
        alert(erro.message || 'Não foi possível conectar ao servidor.');
    } finally {
        if (botao) { botao.disabled = false; botao.textContent = 'Salvar pedido'; }
    }
}
async function carregarItens() {
    if (itensCarregados) { renderItens(); return itens;
    }
    if (carregamentoItens) return carregamentoItens;
    const tbody = document.getElementById('itens-table-body');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">Carregando itens...</td></tr>';
    carregamentoItens = fetch('/api/v1/itens').then(async resposta => {
        if (!resposta.ok) throw new Error('Não foi possível carregar os itens.');
        itens = await resposta.json();
        itensCarregados = true;
        renderItens();
        return itens;
    }).catch(erro => {
        console.error(erro);
        if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:var(--danger-color);">Não foi possível carregar os itens.</td></tr>';
        throw erro;
    }).finally(() => { carregamentoItens = null; });
    return carregamentoItens;
}
async function carregarMRP() { if (currentUser && ['solicitante', 'estoque', 'gerente'].includes(currentUser.perfil)) return; try { const r = await fetch('/api/v1/planejamento'); if (r.ok) { materiaisMRP = await r.json(); renderMRP(); } } catch(e) { console.error(e); } }
function ordenarRotas(rotas) { return [...rotas].sort((a, b) => { const dataA = String(a.data_prevista || ''); const dataB = String(b.data_prevista || ''); const concluidaA = String(a.status || '').trim().toLowerCase() === 'concluido'; const concluidaB = String(b.status || '').trim().toLowerCase() === 'concluido'; if (concluidaA !== concluidaB) return Number(concluidaA) - Number(concluidaB); return dataA.localeCompare(dataB); }); }
async function carregarRotas() { try { const r = await fetch('/api/v1/rotas'); if(r.ok) { rotasData = ordenarRotas(await r.json()); renderRotas(); renderDashboardRotas(); } } catch(e) { console.error(e); } }
async function carregarPrecos() {
    const container = document.getElementById('precos-container');
    const select = document.getElementById('precos-material-select');
    if (currentUser && ['solicitante', 'estoque', 'gerente'].includes(currentUser.perfil)) return;
    if (!container || !select) return;
    try {
        const res = await fetch('/api/v1/precos');
        if (!res.ok) throw new Error('Não foi possível carregar a formação de preços.');
        const agrupados = await res.json();
        const materiais = Object.entries(agrupados);
        if (!materiais.length) {
            container.innerHTML = '<p style="color: var(--text-body);">Nenhum registro de formação de preço importado.</p>';
            return;
        }
        window.precosAgrupados = agrupados;
        select.value = '';
        filtrarMateriaisPreco();
        select.value = materiais[0][0];
        renderRegistrosPrecoSelecionado();
    } catch (erro) {
        console.error(erro);
        container.innerHTML = '<p style="color: var(--danger-color);">Não foi possível carregar a formação de preços.</p>';
    }
}
function importarPrecosExcel() { document.getElementById('precos-excel-input')?.click(); }
async function enviarImportacaoPrecos(campo) {
    const arquivo = campo.files?.[0];
    if (!arquivo) return;
    const dados = new FormData();
    dados.append('arquivo', arquivo);
    try {
        const resposta = await fetch('/api/v1/precos/importar', { method: 'POST', body: dados });
        const resultado = await resposta.json();
        if (!resposta.ok) { alert(resultado.erro || 'Falha na importação.'); return; }
        alert(resultado.mensagem);
        await carregarPrecos();
    } catch (erro) {
        alert(erro.message || 'Não foi possível importar o Excel.');
    } finally {
        campo.value = '';
    }
}

function dataAgendaHoje() {
    const agora = new Date();
    return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`;
}

async function carregarAgenda() {
    const campo = document.getElementById('agenda-data');
    const lista = document.getElementById('agenda-lista');
    if (!campo || !lista) return;
    if (!campo.value) campo.value = dataAgendaHoje();
    lista.innerHTML = '<div class="agenda-vazia">Carregando sua agenda...</div>';
    try {
        const resposta = await fetch(`/api/v1/agenda?data=${encodeURIComponent(campo.value)}`);
        if (!resposta.ok) throw new Error('Falha ao carregar agenda');
        tarefasAgenda = await resposta.json();
        renderAgenda();
    } catch (erro) {
        console.error(erro);
        lista.innerHTML = '<div class="agenda-vazia">Não foi possível carregar a agenda.</div>';
    }
}

async function carregarDestinatariosAgenda() {
    try {
        const resposta = await fetch('/api/v1/agenda/usuarios');
        if (!resposta.ok) return;
        const usuarios = await resposta.json();
        usuariosAgenda = usuarios;
    } catch (erro) { console.error(erro); }
}

function renderAgenda() {
    const lista = document.getElementById('agenda-lista');
    const resumo = document.getElementById('agenda-resumo');
    if (!lista) return;
    const pendentes = tarefasAgenda.filter(tarefa => !tarefa.concluida).length;
    if (resumo) resumo.textContent = tarefasAgenda.length ? `${pendentes} pendente${pendentes === 1 ? '' : 's'} de ${tarefasAgenda.length} demanda${tarefasAgenda.length === 1 ? '' : 's'}.` : 'Nenhuma demanda anotada para este dia.';
    lista.innerHTML = tarefasAgenda.length ? tarefasAgenda.map(tarefa => `
        <div class="agenda-tarefa ${tarefa.concluida ? 'concluida' : ''}">
            <input type="checkbox" ${tarefa.concluida ? 'checked' : ''} onchange="alternarTarefaAgenda(${tarefa.id}, this.checked)" aria-label="Concluir tarefa">
            <div class="agenda-tarefa-conteudo"><span>${escapeHTML(tarefa.titulo)}</span>${tarefa.observacao ? `<small>${escapeHTML(tarefa.observacao)}</small>` : ''}${tarefa.destinatarios?.length ? `<small>Compartilhada com: ${tarefa.destinatarios.map(usuario => escapeHTML(usuario.nome)).join(', ')}</small>` : ''}</div>
            <button type="button" class="agenda-acao ${tarefa.concluida ? '' : 'agenda-concluir'}" onclick="alternarTarefaAgenda(${tarefa.id}, ${!tarefa.concluida})" title="${tarefa.concluida ? 'Reabrir tarefa' : 'Concluir tarefa'}">${tarefa.concluida ? 'Reabrir' : 'Concluir'}</button>
            <button type="button" class="agenda-acao" onclick="editarTarefaAgenda(${tarefa.id})" title="Editar tarefa">Editar</button>${tarefa.criador_id === currentUser?.id ? `<button type="button" class="agenda-acao agenda-enviar" onclick="abrirEnvioAgenda(${tarefa.id})" title="Enviar anotação">Enviar</button>` : ''}
            <button type="button" class="agenda-acao agenda-remover" onclick="removerTarefaAgenda(${tarefa.id})" title="Excluir tarefa">&#215;</button>
        </div>`).join('') : '<div class="agenda-vazia">Sua lista está livre. Adicione a primeira demanda acima.</div>';
}

function mudarDataAgenda(dias) {
    const campo = document.getElementById('agenda-data');
    if (!campo) return;
    const data = new Date(`${campo.value || dataAgendaHoje()}T12:00:00`);
    data.setDate(data.getDate() + dias);
    campo.value = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
    carregarAgenda();
}

async function adicionarTarefaAgenda(event) {
    event.preventDefault();
    const campo = document.getElementById('agenda-nova-tarefa');
    const data = document.getElementById('agenda-data')?.value || dataAgendaHoje();
    if (!campo?.value.trim()) return;
    const resposta = await fetch('/api/v1/agenda', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({titulo: campo.value.trim(), data, destinatarios: []}) });
    if (!resposta.ok) { alert('Não foi possível adicionar a demanda.'); return; }
    campo.value = '';
    await carregarAgenda();
}

async function alternarTarefaAgenda(id, concluida) {
    const resposta = await fetch(`/api/v1/agenda/${id}`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({concluida}) });
    if (resposta.ok) await carregarAgenda();
}

async function editarTarefaAgenda(id) {
    const tarefa = tarefasAgenda.find(item => item.id === id);
    if (!tarefa) return;
    document.getElementById('agenda-editar-id').value = id;
    document.getElementById('agenda-editar-titulo').value = tarefa.titulo;
    document.getElementById('modalEditarAgenda').classList.add('active');
    document.getElementById('agenda-editar-titulo').focus();
}

function fecharModalEditarAgenda() {
    document.getElementById('modalEditarAgenda')?.classList.remove('active');
}

async function salvarEdicaoTarefaAgenda(event) {
    event.preventDefault();
    const id = document.getElementById('agenda-editar-id').value;
    const titulo = document.getElementById('agenda-editar-titulo').value.trim();
    if (!id || !titulo) return;
    const resposta = await fetch(`/api/v1/agenda/${id}`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({titulo}) });
    if (!resposta.ok) { alert('Não foi possível editar a demanda.'); return; }
    fecharModalEditarAgenda();
    await carregarAgenda();
}

async function removerTarefaAgenda(id) {
    if (!await confirmarAcao('Confirma excluir esta demanda da agenda? Esta ação não pode ser desfeita.')) return;
    const resposta = await fetch(`/api/v1/agenda/${id}`, { method: 'DELETE' });
    if (resposta.ok) await carregarAgenda();
}

async function prepararSugestoesPrecoDashboard() {
    if (window.precosAgrupados) return;
    try {
        const res = await fetch('/api/v1/precos');
        if (res.ok) window.precosAgrupados = await res.json();
    } catch (erro) { console.error(erro); }
}

async function pesquisarPrecoDashboard() {
    const campo = document.getElementById('dashboard-preco-search');
    const lista = document.getElementById('dashboard-preco-suggestions');
    if (!campo || !lista) return;
    await prepararSugestoesPrecoDashboard();
    const busca = campo.value.trim().toLowerCase();
    if (!busca || !window.precosAgrupados) {
        lista.classList.remove('visible');
        lista.innerHTML = '';
        return;
    }
    const materiais = Object.keys(window.precosAgrupados).filter(material => material.toLowerCase().includes(busca)).slice(0, 8);
    lista.innerHTML = materiais.length ? materiais.map(material => `<button type="button" class="item-suggestion" role="option" data-material="${escapeHTML(material)}"><span class="item-suggestion-code">Material</span><span class="item-suggestion-description">${escapeHTML(material)}</span></button>`).join('') : '<div class="item-suggestions-empty">Nenhum material encontrado.</div>';
    lista.classList.add('visible');
    lista.querySelectorAll('[data-material]').forEach(botao => botao.addEventListener('click', () => abrirPrecoPesquisado(null, botao.dataset.material)));
}

async function abrirPrecoPesquisado(event, materialInformado = null) {
    if (event) event.preventDefault();
    const campo = document.getElementById('dashboard-preco-search');
    const materialBusca = (materialInformado || campo?.value || '').trim().toLowerCase();
    if (!materialBusca) return;
    await prepararSugestoesPrecoDashboard();
    const material = Object.keys(window.precosAgrupados || {}).find(nome => nome.toLowerCase() === materialBusca) || Object.keys(window.precosAgrupados || {}).find(nome => nome.toLowerCase().includes(materialBusca));
    if (!material) {
        alert('Nenhum material de formação de preço encontrado.');
        return;
    }
    mostrarPrecoNoDashboard(material);
    const lista = document.getElementById('dashboard-preco-suggestions');
    if (lista) { lista.classList.remove('visible'); lista.innerHTML = ''; }
}

function mostrarPrecoNoDashboard(material) {
    const container = document.getElementById('dashboard-preco-result');
    const registros = window.precosAgrupados?.[material] || [];
    if (!container || !registros.length) return;
    const dinheiro = valor => valor == null ? '-' : Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const percentual = valor => valor == null ? '-' : `${Number(valor).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
    const media = campo => { const valores = registros.map(registro => Number(registro[campo])).filter(valor => Number.isFinite(valor)); return valores.length ? valores.reduce((total, valor) => total + valor, 0) / valores.length : null; };
    const mediaFio = media('valor_fio_kg');
    const mediaServico = media('valor_servico_kg');
    const mediaPerda = media('perda_percentual');
    const mediaPreco = media('preco_final_kg');
    container.innerHTML = `<div class="dashboard-media-only"><span class="preco-card-kicker">Médias de ${escapeHTML(material)}</span><div class="preco-media-grid"><div><span>Média do fio</span><strong>${dinheiro(mediaFio)}</strong><small>por kg</small></div><div><span>Média do serviço</span><strong>${dinheiro(mediaServico)}</strong><small>por kg</small></div><div><span>Média da perda</span><strong>${percentual(mediaPerda)}</strong></div><div><span>Média do preço final</span><strong>${dinheiro(mediaPreco)}</strong><small>por kg</small></div></div></div>`;
    container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function filtrarMateriaisPreco() {
    const select = document.getElementById('precos-material-select');
    const busca = (document.getElementById('precos-material-search')?.value || '').trim().toLowerCase();
    const sugestoes = document.getElementById('precos-material-suggestions');
    if (!select || !window.precosAgrupados) return;
    const selecionado = select.value;
    const materiais = Object.keys(window.precosAgrupados).filter(material => {
        const registros = window.precosAgrupados[material];
        const fornecedor = registros.map(registro => registro.fornecedor_servico || '').join(' ');
        return `${material} ${fornecedor}`.toLowerCase().includes(busca);
    });
    select.innerHTML = '<option value="">Selecione um material...</option>' + materiais.map(material => `<option value="${escapeHTML(material)}">${escapeHTML(material)}</option>`).join('');
    if (materiais.includes(selecionado)) select.value = selecionado;
    else if (materiais.length === 1) select.value = materiais[0];
    if (sugestoes) {
        if (!busca) {
            sugestoes.classList.remove('visible');
            sugestoes.innerHTML = '';
        } else if (!materiais.length) {
            sugestoes.innerHTML = '<div class="item-suggestions-empty">Nenhum material encontrado.</div>';
            sugestoes.classList.add('visible');
        } else {
            sugestoes.innerHTML = materiais.slice(0, 8).map(material => `<button type="button" class="item-suggestion" role="option" onclick="selecionarMaterialPreco('${escapeHTML(material)}')"><span class="item-suggestion-code">Material</span><span class="item-suggestion-description">${escapeHTML(material)}</span></button>`).join('');
            sugestoes.classList.add('visible');
        }
    }
    renderRegistrosPrecoSelecionado();
}

function selecionarMaterialPreco(material) {
    const campo = document.getElementById('precos-material-search');
    const select = document.getElementById('precos-material-select');
    const sugestoes = document.getElementById('precos-material-suggestions');
    if (campo) campo.value = material;
    if (select) select.value = material;
    if (sugestoes) {
        sugestoes.classList.remove('visible');
        sugestoes.innerHTML = '';
    }
    renderRegistrosPrecoSelecionado();
}

function renderRegistrosPrecoSelecionado() {
    const select = document.getElementById('precos-material-select');
    const container = document.getElementById('precos-container');
    const material = select?.value;
    const registros = material && window.precosAgrupados ? window.precosAgrupados[material] : [];
    if (!container) return;
    if (!material || !registros.length) {
        container.innerHTML = '<div class="precos-empty">Selecione um material para visualizar os registros.</div>';
        return;
    }
    const dinheiro = valor => valor == null ? '-' : Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const percentual = valor => valor == null ? '-' : `${Number(valor).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
    const ultimo = [...registros].reverse().find(registro => registro.preco_final_kg != null);
    const fornecedor = registros.find(registro => registro.fornecedor_servico)?.fornecedor_servico || 'Fornecedor não informado';
    const media = campo => {
        const valores = registros.map(registro => Number(registro[campo])).filter(valor => Number.isFinite(valor));
        return valores.length ? valores.reduce((total, valor) => total + valor, 0) / valores.length : null;
    };
    const mediaFio = media('valor_fio_kg');
    const mediaServico = media('valor_servico_kg');
    const mediaPerda = media('perda_percentual');
    const mediaPreco = media('preco_final_kg');
    container.innerHTML = `<article class="preco-card"><div class="preco-card-head"><div><span class="preco-card-kicker">Material selecionado</span><h2>${escapeHTML(material)}</h2><span class="preco-card-supplier">${escapeHTML(fornecedor)}</span></div><div class="preco-card-tools"><span class="preco-card-count">${registros.length} ${registros.length === 1 ? 'registro' : 'registros'}</span><button class="btn btn-outline" type="button" onclick="abrirModalPreco()">+ Registro</button></div></div><div class="preco-highlight"><span>Último preço final</span><strong>${ultimo ? dinheiro(ultimo.preco_final_kg) : '-'}</strong><small>por kg</small></div><div class="preco-media-grid"><div><span>Média do fio</span><strong>${dinheiro(mediaFio)}</strong><small>por kg</small></div><div><span>Média do serviço</span><strong>${dinheiro(mediaServico)}</strong><small>por kg</small></div><div><span>Média da perda</span><strong>${percentual(mediaPerda)}</strong></div><div><span>Média do preço final</span><strong>${dinheiro(mediaPreco)}</strong><small>por kg</small></div></div><div class="preco-table-wrap"><table><thead><tr><th>Data</th><th>NFE</th><th>Fio</th><th>Serviço</th><th>Perda</th><th>Preço final</th><th>Observação</th><th>Ações</th></tr></thead><tbody>${registros.map(registro => { const fios = (registro.fios || []).map(fio => `${escapeHTML(fio.nome)}: ${dinheiro(fio.valor_kg)}`).join('<br>'); return `<tr><td>${escapeHTML(registro.data_recebimento || '-')}</td><td>${escapeHTML(registro.nfe || '-')}</td><td>${fios || dinheiro(registro.valor_fio_kg)}</td><td>${dinheiro(registro.valor_servico_kg)}</td><td>${percentual(registro.perda_percentual)}</td><td><strong>${dinheiro(registro.preco_final_kg)}</strong></td><td>${escapeHTML(registro.observacao || '-')}</td><td><button class="btn btn-outline preco-action" type="button" onclick="editarPreco(${registro.id})">Editar</button><button class="btn btn-outline preco-action preco-delete" type="button" onclick="excluirPreco(${registro.id})">Excluir</button></td></tr>`; }).join('')}</tbody></table></div></article>`;
}

function abrirModalPreco(id = null) {
    const form = document.getElementById('formPreco');
    if (!form) return;
    form.reset();
    document.getElementById('preco_edit_id').value = id || '';
    document.getElementById('tituloModalPreco').textContent = id ? 'Editar Registro de Preço' : 'Novo Registro de Preço';
    document.getElementById('preco_material_nome').value = id ? document.getElementById('precos-material-select').value : '';
    fecharSugestoesPreco();
    atualizarFiosPreco();
    document.getElementById('modalPreco').classList.add('active');
}

function fecharModalPreco() { document.getElementById('modalPreco')?.classList.remove('active'); }

function fecharSugestoesPreco() {
    ['preco-material-suggestions', 'preco-fornecedor-suggestions'].forEach(id => {
        const lista = document.getElementById(id);
        if (lista) { lista.classList.remove('visible'); lista.innerHTML = ''; }
    });
}

function pesquisarMaterialPreco(valor) {
    const lista = document.getElementById('preco-material-suggestions');
    const termo = String(valor || '').trim().toLowerCase();
    if (!lista) return;
    if (termo.length < 2) { lista.classList.remove('visible'); lista.innerHTML = ''; return; }
    const resultados = itens.filter(item => `${item.codigo} ${item.descricao}`.toLowerCase().includes(termo)).slice(0, 30);
    lista.innerHTML = resultados.length
        ? resultados.map(item => `<button type="button" class="item-suggestion" data-value="${escapeAttribute(item.descricao)}"><span class="item-suggestion-code">${escapeHTML(item.codigo)}</span><span class="item-suggestion-description">${escapeHTML(item.descricao)}</span></button>`).join('')
        : '<div class="item-suggestions-empty">Nenhum material cadastrado encontrado.</div>';
    lista.classList.add('visible');
    lista.querySelectorAll('[data-value]').forEach(botao => botao.addEventListener('click', () => {
        const campo = document.getElementById('preco_material_nome');
        campo.value = botao.dataset.value;
        atualizarFiosPreco();
        lista.classList.remove('visible');
        lista.innerHTML = '';
    }));
}

function pesquisarFornecedorPreco(valor) {
    const lista = document.getElementById('preco-fornecedor-suggestions');
    const termo = String(valor || '').trim().toLowerCase();
    if (!lista) return;
    if (termo.length < 2) { lista.classList.remove('visible'); lista.innerHTML = ''; return; }
    const resultados = fornecedores.filter(fornecedor => `${fornecedor.razao_social} ${fornecedor.nome_fantasia || ''} ${fornecedor.codigo || ''} ${fornecedor.cnpj || ''}`.toLowerCase().includes(termo)).slice(0, 30);
    lista.innerHTML = resultados.length
        ? resultados.map(fornecedor => `<button type="button" class="item-suggestion" data-value="${escapeHTML(fornecedor.razao_social)}"><span class="item-suggestion-code">${escapeHTML(fornecedor.codigo || fornecedor.cnpj || 'Fornecedor')}</span><span class="item-suggestion-description">${escapeHTML(fornecedor.razao_social)}</span></button>`).join('')
        : '<div class="item-suggestions-empty">Nenhum fornecedor encontrado.</div>';
    lista.classList.add('visible');
    lista.querySelectorAll('[data-value]').forEach(botao => botao.addEventListener('click', () => {
        document.getElementById('preco_fornecedor_servico').value = botao.dataset.value;
        lista.classList.remove('visible');
        lista.innerHTML = '';
    }));
}

function editarPreco(id) {
    const registro = Object.values(window.precosAgrupados || {}).flat().find(item => item.id === id);
    if (!registro) return;
    abrirModalPreco(id);
    document.getElementById('preco_material_nome').value = registro.material_nome || '';
    document.getElementById('preco_fornecedor_servico').value = registro.fornecedor_servico || '';
    document.getElementById('preco_data_recebimento').value = registro.data_recebimento || '';
    document.getElementById('preco_nfe').value = registro.nfe || '';
    document.getElementById('preco_observacao').value = registro.observacao || '';
    document.getElementById('preco_valor_fio').value = registro.valor_fio_kg ?? '';
    document.getElementById('preco_valor_servico').value = registro.valor_servico_kg ?? '';
    document.getElementById('preco_frete').value = registro.frete_kg ?? '';
    document.getElementById('preco_peso_bruto').value = registro.peso_bruto ?? '';
    document.getElementById('preco_peso_liquido').value = registro.peso_liquido ?? '';
    atualizarFiosPreco(registro.fios || []);
}

function adicionarFioPreco(fio = {}) {
    const lista = document.getElementById('preco-fios-list');
    if (!lista) return;
    const linha = document.createElement('div');
    linha.className = 'preco-fio-row';
    linha.innerHTML = `<input class="preco-fio-nome" placeholder="Nome do fio" value="${escapeHTML(fio.nome || '')}"><input class="preco-fio-valor" type="number" step="any" placeholder="Valor (R$/KG)" value="${fio.valor_kg ?? ''}"><button type="button" class="btn btn-outline" onclick="this.parentElement.remove()" title="Remover fio">Remover</button>`;
    lista.appendChild(linha);
}

function atualizarFiosPreco(fios = []) {
    const material = document.getElementById('preco_material_nome')?.value || '';
    const grupo = document.getElementById('preco-fios-group');
    const lista = document.getElementById('preco-fios-list');
    if (!grupo || !lista) return;
    const ehPiquet = material.toLowerCase().includes('piquet');
    grupo.style.display = ehPiquet ? 'block' : 'none';
    lista.innerHTML = '';
    if (ehPiquet) (fios.length ? fios : [{}]).forEach(adicionarFioPreco);
}

async function salvarPreco(event) {
    event.preventDefault();
    const id = document.getElementById('preco_edit_id').value;
    const materialNome = document.getElementById('preco_material_nome').value;
    const fios = [...document.querySelectorAll('.preco-fio-row')].map(linha => ({ nome: linha.querySelector('.preco-fio-nome').value.trim(), valor_kg: linha.querySelector('.preco-fio-valor').value })).filter(fio => fio.nome || fio.valor_kg);
    if (materialNome.toLowerCase().includes('piquet') && (!fios.length || fios.some(fio => !fio.nome || fio.valor_kg === ''))) { alert('Informe o nome e o valor de cada fio do Piquet.'); return; }
    const payload = { material_nome: materialNome, fornecedor_servico: document.getElementById('preco_fornecedor_servico').value, data_recebimento: document.getElementById('preco_data_recebimento').value, nfe: document.getElementById('preco_nfe').value, observacao: document.getElementById('preco_observacao').value, valor_fio_kg: document.getElementById('preco_valor_fio').value, valor_servico_kg: document.getElementById('preco_valor_servico').value, frete_kg: document.getElementById('preco_frete').value, peso_bruto: document.getElementById('preco_peso_bruto').value, peso_liquido: document.getElementById('preco_peso_liquido').value, fios };
    const res = await fetch(id ? `/api/v1/precos/${id}` : '/api/v1/precos', { method: id ? 'PUT' : 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) });
    if (!res.ok) { const textoResposta = await res.text(); let erro = {}; try { erro = JSON.parse(textoResposta); } catch (parseError) { erro = { erro: `Servidor respondeu HTTP ${res.status}. Reinicie o sistema para carregar esta função.` }; } alert(erro.erro || 'Não foi possível salvar o registro.'); return; }
    fecharModalPreco();
    await carregarPrecos();
    const material = payload.material_nome;
    if (window.precosAgrupados?.[material]) selecionarMaterialPreco(material);
    mostrarAviso(id ? 'Registro de preço atualizado.' : 'Registro de preço salvo.', 'success');
}

async function excluirPreco(id) {
    if (!await confirmarAcao('Confirma a exclusão deste registro de formação de preço? Esta ação não pode ser desfeita.')) return;
    const res = await fetch(`/api/v1/precos/${id}`, { method: 'DELETE' });
    if (res.ok) await carregarPrecos();
}
async function consultarDashboard(e) {
    e.preventDefault();
    const campo = document.getElementById('dashboard-pergunta');
    const painel = document.getElementById('dashboard-resposta');
    const pergunta = campo.value.trim();
    if (!pergunta) return;
    painel.style.display = 'block';
    if (pergunta.toLowerCase() === 'ajuda') {
        painel.innerHTML = `<div style="padding:12px; background:var(--bg-color); border:1px solid var(--border-color); border-radius:var(--radius-md);"><strong>Perguntas que você pode fazer</strong><div style="display:grid; gap:6px; margin-top:10px; color:var(--text-body); font-size:.85rem;"><div>• Qual fornecedor do item malha?</div><div>• Qual valor da última compra do fornecedor teste?</div><div>• Quando foi o último pedido do fornecedor teste?</div><div>• Qual rota do motorista Lanlan para hoje?</div><div>• Quais destinos estão na rota?</div><div>• Qual endereço da rota?</div><div>• Qual quantidade solicitada de purisme hoje?</div><div>• Qual quantidade solicitada de purisme nos últimos 3 meses?</div><div>• Qual quantidade solicitada de purisme de 01/08 a 10/08?</div></div></div>`;
        return;
    }
    painel.innerHTML = '<span style="color:var(--text-body);">Consultando a operação...</span>';
    try {
        const res = await fetch('/api/v1/dashboard/consulta', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ pergunta }) });
        const resultado = await res.json();
        const cards = (resultado.cards || []).map(card => { const acao = card.tipo === 'ROTA' ? `abrirDetalhesRotaConsulta(${card.id})` : `abrirDetalhesCartao('${escapeHTML(card.id)}', '${card.tipo}')`; return `<button type="button" class="card" style="text-align:left; padding:10px; cursor:pointer; border:1px solid var(--border-color);" onclick="${acao}"><strong>${escapeHTML(card.tipo === 'ROTA' ? 'Rota' : card.id)} - ${escapeHTML(card.titulo)}</strong><small style="display:block; color:var(--text-body); margin-top:4px;">${escapeHTML(card.subtitulo)}</small></button>`; }).join('');
        painel.innerHTML = `<div style="padding:12px; background:var(--bg-color); border:1px solid var(--border-color); border-radius:var(--radius-md);"><strong>Resposta</strong><p style="margin:6px 0 0; color:var(--text-body);">${escapeHTML(resultado.resposta)}</p></div>${cards ? `<div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:10px;"><small style="width:100%; color:var(--text-body);">Cartões relacionados</small>${cards}</div>` : ''}`;
    } catch (erro) {
        console.error(erro);
        painel.innerHTML = '<span style="color:var(--danger-color);">Não foi possível consultar a operação.</span>';
    }
}
async function carregarUsuarios() { if (!currentUser || currentUser.perfil !== 'admin') return; try { const res = await fetch('/api/v1/usuarios'); if (res.ok) { listaUsuarios = await res.json(); renderUsuariosTable(); } } catch(e) { console.error("Erro ao carregar usuários:", e); } }

// === CADASTROS BÁSICOS E FORMULÁRIOS ===
function configurarSugestaoItemLinha(row) {
    const input = row.querySelector('.sc-item-input');
    const lista = row.querySelector('.sc-item-suggestions');
    if (!input || !lista) return;

    const atualizar = () => {
        const termo = input.value.trim().toLowerCase();
        if (termo.length < 2) {
            lista.classList.remove('visible');
            lista.innerHTML = '';
            return;
        }
        const resultados = itens.filter(item => `${item.codigo} ${item.descricao}`.toLowerCase().includes(termo)).slice(0, 20);
        if (!resultados.length) {
            lista.classList.remove('visible');
            lista.innerHTML = '';
            return;
        }
        lista.innerHTML = resultados.map(item => `<button type="button" class="item-suggestion" role="option" data-value="${escapeHTML(item.descricao)}" title="${escapeAttribute(item.descricao)}"><span class="item-suggestion-code">${escapeHTML(item.codigo)}</span><span class="item-suggestion-description" title="${escapeAttribute(item.descricao)}">${escapeHTML(item.descricao)}</span></button>`).join('');
        lista.classList.add('visible');
        lista.querySelectorAll('.item-suggestion').forEach(botao => botao.addEventListener('click', () => {
            input.value = botao.dataset.value;
            lista.classList.remove('visible');
            lista.innerHTML = '';
        }));
    };

    input.addEventListener('input', atualizar);
    input.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            lista.classList.remove('visible');
            lista.innerHTML = '';
        }
    });
}

function adicionarLinhaItemSolicitacao(item = '', quantidade = '') {
    const container = document.getElementById('itens-solicitacao-list');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'sc-item-row';
    row.style.display = 'grid';
    row.style.gridTemplateColumns = 'minmax(0, 2.4fr) minmax(120px, 1fr) auto';
    row.style.gap = '8px';
    row.style.marginBottom = '8px';
    row.innerHTML = `
        <div class="item-search sc-item-search" style="position:relative;">
            <input type="text" class="sc-item-input" value="${escapeAttribute(item)}" placeholder="Item / material" style="width:100%;" autocomplete="off">
            <div class="item-suggestions sc-item-suggestions" role="listbox"></div>
        </div>
        <input type="number" step="any" class="sc-qtd-input" value="${escapeAttribute(quantidade)}" placeholder="Qtd" style="width:100%;" min="0.01">
        <button type="button" class="btn btn-outline" onclick="this.parentElement.remove()" title="Remover item">Remover</button>
    `;
    container.appendChild(row);
    configurarSugestaoItemLinha(row);
}

function resetarItensSolicitacao() {
    const container = document.getElementById('itens-solicitacao-list');
    if (!container) return;
    container.innerHTML = '';
    adicionarLinhaItemSolicitacao();
}

function coletarItensSolicitacao() {
    const linhas = [...document.querySelectorAll('.sc-item-row')];
    const itens = linhas.map(linha => ({
        item: linha.querySelector('.sc-item-input')?.value?.trim() || '',
        quantidade: linha.querySelector('.sc-qtd-input')?.value ?? ''
    })).filter(item => item.item && item.quantidade !== '');
    return itens;
}

async function submitForm(e) { e.preventDefault(); if (solicitacaoEnviando) return; solicitacaoEnviando = true; const botao = e.target.querySelector('button[type="submit"]'); const textoOriginal = botao ? botao.textContent : ''; if (botao) { botao.disabled = true; botao.textContent = 'Salvando...'; } const itens = coletarItensSolicitacao(); const payload = { numero_pedido_sap: document.getElementById('numero_pedido_sap').value }; if (itens.length > 0) { payload.itens = itens; } else { alert('Informe ao menos um item e sua quantidade.'); solicitacaoEnviando = false; if (botao) { botao.disabled = false; botao.textContent = textoOriginal; } return; } try { const r = await fetch('/api/v1/solicitacoes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const resultado = await r.json(); if (r.ok) { closeModal(); mostrarAviso('Solicitação salva com sucesso.', 'success'); carregarSolicitacoes(true); } else { alert(resultado.erro || 'Não foi possível criar a solicitação.'); } } catch (e) { console.error(e); alert('Não foi possível conectar ao servidor.'); } finally { solicitacaoEnviando = false; if (botao) { botao.disabled = false; botao.textContent = textoOriginal; } } }
async function submitItem(e) { e.preventDefault(); const payload = { codigo: document.getElementById('item_codigo').value, descricao: document.getElementById('item_descricao').value, estoque: document.getElementById('item_estoque').value, grupo: document.getElementById('item_grupo').value, fabricante: document.getElementById('item_fabricante').value, unidade: document.getElementById('item_unidade').value, ultimo_preco: document.getElementById('item_preco').value }; const id = document.getElementById('item_edit_id').value; try { const r = await fetch(id ? `/api/v1/itens/${id}` : '/api/v1/itens', { method: id ? 'PUT' : 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) }); const resultado = await r.json(); if (r.ok) { const voltarAoPO = retornarAoPOAposCadastroItem; retornarAoPOAposCadastroItem = false; closeModalItem(); await carregarItens(); if (voltarAoPO && !id) { document.getElementById('novo_po_item').value = resultado.descricao || payload.descricao; document.getElementById('modalNovoPO').classList.add('active'); document.getElementById('novo_po_item').focus(); } mostrarAviso(id ? 'Item atualizado com sucesso.' : 'Item salvo com sucesso.', 'success'); } else { alert(resultado.erro || 'Não foi possível salvar o item.'); } } catch (e) { console.error(e); alert('Não foi possível conectar ao servidor.'); } }
async function submitImportacaoItens(e) { e.preventDefault(); const arquivo = document.getElementById('arquivo_itens').files[0]; const dados = new FormData(); dados.append('arquivo', arquivo); try { const r = await fetch('/api/v1/itens/importar', { method: 'POST', body: dados }); const resultado = await r.json(); if (r.ok) { alert(`Importação concluída: ${resultado.importados} novos, ${resultado.atualizados} atualizados.`); closeImportacaoItens(); await carregarItens(); } else { alert(resultado.erro || 'Falha na importação.'); } } catch (e) { console.error(e); } }
async function submitImportacaoFornecedores(e) { e.preventDefault(); const arquivo = document.getElementById('arquivo_fornecedores').files[0]; const dados = new FormData(); dados.append('arquivo', arquivo); try { const r = await fetch('/api/v1/fornecedores/importar', { method: 'POST', body: dados }); const tipo = r.headers.get('content-type') || ''; const resultado = tipo.includes('application/json') ? await r.json() : { erro: `Servidor respondeu HTTP ${r.status}. Reinicie o sistema para carregar a rota de importação.` }; if (r.ok) { alert(`Importação concluída: ${resultado.importados} novos, ${resultado.atualizados} atualizados${resultado.ignorados.length ? `; ${resultado.ignorados.length} ignorados.` : '.'}`); closeImportacaoFornecedores(); await carregarFornecedores(); } else { alert(resultado.erro || 'Falha na importação.'); } } catch (e) { console.error(e); alert('Não foi possível conectar ao servidor.'); } }
function adicionarLinhaItemPedidoDireto(item = '', valor = '') {
    const container = document.getElementById('itens-pedido-direto-list');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'po-item-row';
    row.style.display = 'grid';
    row.style.gridTemplateColumns = 'minmax(0, 2.2fr) minmax(120px, 1fr) auto';
    row.style.gap = '8px';
    row.style.marginBottom = '8px';
    row.innerHTML = `
        <input type="text" class="po-item-input" value="${escapeAttribute(item)}" placeholder="Item / material" style="width:100%;" autocomplete="off">
        <input type="number" step="0.01" class="po-valor-input" value="${escapeAttribute(valor)}" placeholder="Valor total" style="width:100%;" min="0.01">
        <button type="button" class="btn btn-outline" onclick="this.parentElement.remove()" title="Remover item">Remover</button>
    `;
    container.appendChild(row);
}

function resetarItensPedidoDireto() {
    const container = document.getElementById('itens-pedido-direto-list');
    if (!container) return;
    container.innerHTML = '';
    adicionarLinhaItemPedidoDireto();
}

function coletarItensPedidoDireto() {
    const linhas = [...document.querySelectorAll('.po-item-row')];
    return linhas.map(linha => ({
        item: linha.querySelector('.po-item-input')?.value?.trim() || '',
        valor_total: linha.querySelector('.po-valor-input')?.value ?? ''
    })).filter(item => item.item && item.valor_total !== '');
}

async function submitNovoPO(e) { e.preventDefault(); if (currentUser && (currentUser.perfil === 'solicitante' || currentUser.perfil === 'estoque')) return; const itens = coletarItensPedidoDireto(); const payload = { fornecedor: document.getElementById('novo_po_fornecedor').value, prazo_dias: document.getElementById('novo_po_prazo').value, status: document.getElementById('novo_po_status').value }; if (itens.length > 0) { payload.itens = itens; } else { const item = document.getElementById('novo_po_item').value.trim(); const valor_total = document.getElementById('novo_po_valor').value; if (!item || !valor_total) { alert('Informe ao menos um item e seu valor total.'); return; } payload.item = item; payload.valor_total = valor_total; } try { const res = await fetch('/api/v1/pedidos', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) }); if(res.ok) { closeModalNovoPO(); await carregarPedidos(true); mostrarAviso('Pedido salvo com sucesso.', 'success'); } else { const resultado = await res.json(); alert(resultado.erro || 'Não foi possível salvar o pedido.'); } } catch(err) { console.error(err); alert('Não foi possível conectar ao servidor.'); } }
async function submitFormFornecedor(e) { e.preventDefault(); if (currentUser && (currentUser.perfil === 'solicitante' || currentUser.perfil === 'estoque')) return; const id = document.getElementById('fornecedor_edit_id').value; const payload = { cnpj: document.getElementById('cnpj_fornecedor').value, razao_social: document.getElementById('razao_social').value, nome_fantasia: document.getElementById('nome_fantasia_fornecedor').value, codigo: document.getElementById('codigo_fornecedor').value, uf: document.getElementById('uf_fornecedor').value, cidade: document.getElementById('cidade_fornecedor').value, ativo: document.getElementById('ativo_fornecedor').checked, categoria: document.getElementById('categoria_fornecedor').value || 'Não informada' }; try { const r = await fetch(id ? `/api/v1/fornecedores/${id}` : '/api/v1/fornecedores', { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const resultado = await r.json(); if (r.ok) { await carregarFornecedores(); closeModalFornecedor(); mostrarAviso(id ? 'Fornecedor atualizado com sucesso.' : 'Fornecedor salvo com sucesso.', 'success'); } else { alert(resultado.erro || 'Não foi possível salvar o fornecedor.'); } } catch (e) { console.error(e); alert('Não foi possível conectar ao servidor.'); } }
async function excluirRegistro(url, mensagem, recarregar) { if (!await confirmarAcao(`Confirma a exclusão?\n\n${mensagem}\n\nEsta ação não pode ser desfeita.`)) return; try { const r = await fetch(url, { method: 'DELETE' }); const resultado = await r.json(); if (r.ok) await recarregar(); else alert(resultado.erro || 'Não foi possível excluir.'); } catch (e) { console.error(e); alert('Não foi possível conectar ao servidor.'); } }
function editarItem(item) { document.getElementById('formItem').reset(); document.getElementById('item_edit_id').value = item.id; document.getElementById('item_codigo').value = item.codigo; document.getElementById('item_descricao').value = item.descricao; document.getElementById('item_estoque').value = item.estoque; document.getElementById('item_grupo').value = item.grupo || ''; document.getElementById('item_fabricante').value = item.fabricante || ''; document.getElementById('item_unidade').value = item.unidade || 'UN'; document.getElementById('item_preco').value = item.ultimo_preco ?? ''; document.getElementById('tituloModalItem').textContent = 'Editar Item'; document.getElementById('modalItem').classList.add('active'); }
function editarFornecedor(fornecedor) { document.getElementById('formFornecedor').reset(); document.getElementById('fornecedor_edit_id').value = fornecedor.id; document.getElementById('cnpj_fornecedor').value = fornecedor.cnpj; document.getElementById('razao_social').value = fornecedor.razao_social; document.getElementById('nome_fantasia_fornecedor').value = fornecedor.nome_fantasia || ''; document.getElementById('codigo_fornecedor').value = fornecedor.codigo || ''; document.getElementById('uf_fornecedor').value = fornecedor.uf || ''; document.getElementById('cidade_fornecedor').value = fornecedor.cidade || ''; document.getElementById('categoria_fornecedor').value = fornecedor.categoria || ''; document.getElementById('ativo_fornecedor').checked = fornecedor.ativo; document.getElementById('tituloModalFornecedor').textContent = 'Editar Fornecedor'; document.getElementById('modalFornecedor').classList.add('active'); }
async function submitFormUsuario(e) { e.preventDefault(); const id = document.getElementById('usuario_db_id').value; const payload = { nome: document.getElementById('usuario_nome').value, email: document.getElementById('usuario_email').value, senha: document.getElementById('usuario_senha').value, perfil: document.getElementById('usuario_perfil').value }; const url = id ? `/api/v1/usuarios/${id}` : '/api/v1/usuarios'; try { const res = await fetch(url, { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); if (res.ok) { closeModalUsuario(); await carregarUsuarios(); mostrarAviso(id ? 'Usuário atualizado com sucesso.' : 'Usuário salvo com sucesso.', 'success'); } else { const resultado = await res.json(); alert(resultado.erro || 'Erro ao salvar usuário.'); } } catch(err) { console.error(err); alert('Não foi possível conectar ao servidor.'); } }
function openModalAlterarSenha() { document.getElementById('formAlterarSenha').reset(); document.getElementById('modalAlterarSenha').classList.add('active'); document.getElementById('senha-atual').focus(); }
function closeModalAlterarSenha() { document.getElementById('modalAlterarSenha').classList.remove('active'); }
async function submitAlterarSenha(e) {
    e.preventDefault();
    const payload = { senha_atual: document.getElementById('senha-atual').value, nova_senha: document.getElementById('nova-senha').value, confirmacao: document.getElementById('confirmacao-senha').value };
    try {
        const res = await fetch('/api/v1/me/senha', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const resultado = await res.json();
        if (!res.ok) { alert(resultado.erro || 'Não foi possível alterar a senha.'); return; }
        closeModalAlterarSenha();
        mostrarAviso(resultado.mensagem, 'success');
    } catch (erro) { console.error(erro); alert('Não foi possível conectar ao servidor.'); }
}

// === OCORRÊNCIAS FORNECEDORES ===
function registrarProblemaFornecedor(fornecedorId) { document.getElementById('ocorrencia_fornecedor_id').value = fornecedorId; document.getElementById('formOcorrencia').reset(); document.getElementById('modalOcorrencia').classList.add('active'); }
function closeModalOcorrencia() { document.getElementById('modalOcorrencia').classList.remove('active'); }

async function submitOcorrenciaFornecedor(e) {
    e.preventDefault();
    const id = document.getElementById('ocorrencia_fornecedor_id').value;
    if (!id) return;
    try {
        const res = await fetch(`/api/v1/fornecedores/${id}/ocorrencias`, {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                tipo: document.getElementById('ocorrencia_tipo').value, 
                descricao: document.getElementById('ocorrencia_descricao').value 
            })
        });
        if (res.ok) { 
            closeModalOcorrencia(); 
            await carregarFornecedores(); 
        } else { 
            alert("Erro ao registrar."); 
        }
    } catch(err) { 
        console.error(err); 
    }
}

// === LÓGICAS DO MRP (NOVA DEMANDA, EDITAR, GERAR SC PARCIAL ESTILIZADA) ===
async function submitNovoMRP(e) {
    e.preventDefault();
    const itemId = document.getElementById('novo_mrp_item_id').value;
    const materialUtilizado = document.getElementById('novo_mrp_item_busca').value.trim();
    if (!materialUtilizado) { alert('Informe o material utilizado.'); return; }
    const payload = {
        item_id: itemId,
        produto_nome: document.getElementById('novo_mrp_produto_nome').value.trim(),
        cliente: document.getElementById('novo_mrp_cliente').value.trim(),
        material_utilizado: materialUtilizado,
        estoque_atual: document.getElementById('novo_mrp_estoque').value,
        demanda_pecas: document.getElementById('novo_mrp_demanda').value,
        consumo_por_peca: document.getElementById('novo_mrp_consumo').value,
        comprado_recebido: document.getElementById('novo_mrp_comprado').value,
        eh_demillus: document.getElementById('novo_mrp_demillus').checked
    };
    try {
        const res = await fetch('/api/v1/planejamento', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) });
        if (res.ok) { closeModalNovoMRP(); await carregarMRP(); }
    } catch (err) { console.error(err); }
}

async function submitImportacaoMRP(e) {
    e.preventDefault();
    const arquivo = document.getElementById('arquivo_mrp').files[0];
    if (!arquivo) return;
    const dados = new FormData();
    dados.append('arquivo', arquivo);
    try {
        const resposta = await fetch('/api/v1/planejamento/importar', { method: 'POST', body: dados });
        const resultado = await resposta.json();
        if (!resposta.ok) { alert(resultado.erro || 'Falha na importação do MRP.'); return; }
        fecharImportacaoMRP();
        await carregarMRP();
        mostrarAviso(`${resultado.materiais} materiais importados de ${resultado.abas} abas, com histórico completo.`, 'success');
    } catch (erro) { console.error(erro); alert('Não foi possível importar a planilha do MRP.'); }
}

function abrirImportacaoMRP() {
    document.getElementById('formImportacaoMRP').reset();
    document.getElementById('modalImportacaoMRP').classList.add('active');
}

function fecharImportacaoMRP() {
    document.getElementById('modalImportacaoMRP').classList.remove('active');
}

async function abrirEditMRP(id) {
    const mat = materiaisMRP.find(m => m.id === id);
    if (!mat) return;
    await carregarItens().catch(() => {});
    document.getElementById('edit_mrp_id').value = mat.id;
    document.getElementById('edit_mrp_nome').value = mat.nome;
    document.getElementById('edit_mrp_produto_nome').value = mat.produto_nome || mat.nome;
    document.getElementById('edit_mrp_cliente').value = mat.cliente || '';
    document.getElementById('edit_mrp_item_id').value = mat.item_id || '';
    document.getElementById('edit_mrp_item_busca').value = mat.item_referencia ? `${mat.item_referencia.codigo} - ${mat.item_referencia.descricao}` : mat.nome;
    document.getElementById('edit_mrp_estoque').value = mat.estoque_atual;
    document.getElementById('edit_mrp_demanda').value = mat.demanda_pecas;
    document.getElementById('edit_mrp_consumo').value = mat.consumo_por_peca;
    document.getElementById('edit_mrp_comprado').value = mat.comprado_recebido;
    document.getElementById('edit_mrp_demillus').checked = Boolean(mat.eh_demillus);
    document.getElementById('modalEditMRP').classList.add('active');
}

async function submitEditMRP(e) {
    e.preventDefault();
    const id = document.getElementById('edit_mrp_id').value;
    const itemId = document.getElementById('edit_mrp_item_id').value;
    const materialUtilizado = document.getElementById('edit_mrp_item_busca').value.trim();
    if (!materialUtilizado) { alert('Informe o material utilizado.'); return; }
    const payload = {
        item_id: itemId || null,
        produto_nome: document.getElementById('edit_mrp_produto_nome').value.trim(),
        cliente: document.getElementById('edit_mrp_cliente').value.trim(),
        material_utilizado: materialUtilizado,
        estoque_atual: document.getElementById('edit_mrp_estoque').value,
        demanda_pecas: document.getElementById('edit_mrp_demanda').value,
        consumo_por_peca: document.getElementById('edit_mrp_consumo').value,
        comprado_recebido: document.getElementById('edit_mrp_comprado').value,
        eh_demillus: document.getElementById('edit_mrp_demillus').checked
    };
    try {
        const res = await fetch(`/api/v1/planejamento/${id}`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) });
        if (res.ok) { closeModalEditMRP(); await carregarMRP(); }
    } catch (err) { console.error(err); }
}

async function submitNovoPedidoMRP(e) {
    e.preventDefault();
    const materialId = document.getElementById('pedido_mrp_material_id').value;
    const linhas = [...document.querySelectorAll('.pedido-mrp-material-row')].filter(linha => linha.querySelector('.pedido-mrp-material')?.checked).map(linha => ({ material_id: Number(linha.querySelector('.pedido-mrp-material').value), quantidade_pecas: linha.querySelector('.pedido-mrp-material-quantidade').value }));
    if (!materialId || !linhas.length || linhas.some(linha => !Number.isFinite(Number(linha.quantidade_pecas)) || Number(linha.quantidade_pecas) <= 0)) { alert('Selecione pelo menos um material e informe uma quantidade positiva para cada um.'); return; }
    try {
        for (const linha of linhas) {
            const res = await fetch('/api/v1/planejamento/pedidos', { method: 'POST', cache: 'no-store', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ material_id: linha.material_id, material_ids: [linha.material_id], quantidade_pecas: linha.quantidade_pecas, produto: document.getElementById('pedido_mrp_produto_input').value.trim() }) });
            const tipoResposta = res.headers.get('content-type') || '';
            const resultado = tipoResposta.includes('application/json') ? await res.json() : {};
            if (!res.ok) { alert(resultado.erro || `Não foi possível registrar o pedido do material ${linha.material_id} (HTTP ${res.status}).`); return; }
        }
        closeModalNovoPedidoMRP(); await carregarMRP(); mostrarAviso(`${linhas.length} pedido${linhas.length === 1 ? '' : 's'} adicionado${linhas.length === 1 ? '' : 's'}.`, 'success');
    } catch (err) { console.error(err); }
}

function pesquisarProdutoPedidoMRP(valor) {
    const termo = valor.trim().toLowerCase();
    const lista = document.getElementById('pedido-mrp-produto-suggestions');
    if (!lista) return;
    if (termo.length < 2) { lista.classList.remove('visible'); lista.innerHTML = ''; return; }
    const resultados = materiaisMRP.filter(material => `${material.produto_nome || material.nome} ${material.cliente || ''}`.toLowerCase().includes(termo)).slice(0, 30);
    lista.innerHTML = resultados.length ? resultados.map(material => `<button type="button" class="item-suggestion" data-id="${material.id}" data-produto="${escapeHTML(material.produto_nome || material.nome)}"><span class="item-suggestion-code">${escapeHTML(material.cliente || 'Produto')}</span><span class="item-suggestion-description">${escapeHTML(material.produto_nome || material.nome)}</span></button>`).join('') : '<div class="item-suggestions-empty">Nenhum produto encontrado.</div>';
    lista.classList.add('visible');
    lista.querySelectorAll('[data-id]').forEach(botao => botao.addEventListener('click', () => selecionarProdutoPedidoMRP(Number(botao.dataset.id))));
}
function selecionarProdutoPedidoMRP(id) {
    const material = materiaisMRP.find(item => item.id === id);
    if (!material) return;
    document.getElementById('pedido_mrp_material_id').value = material.id;
    document.getElementById('pedido_mrp_produto_input').value = material.produto_nome || material.nome;
    const grupo = materiaisMRP.filter(item => String(item.cliente || '').trim().toLowerCase() === String(material.cliente || '').trim().toLowerCase() && String(item.produto_nome || item.nome).trim().toLowerCase() === String(material.produto_nome || material.nome).trim().toLowerCase());
    document.getElementById('pedido-mrp-materiais-group').style.display = '';
    document.getElementById('pedido-mrp-materiais-lista').innerHTML = grupo.map(item => `<div class="pedido-mrp-material-row"><label class="pedido-mrp-material-option"><input class="pedido-mrp-material" type="checkbox" value="${item.id}" ${item.id === material.id ? 'checked' : ''} onchange="atualizarMateriaisPedidoMRP()"><span><strong>${escapeHTML(item.material_utilizado || item.nome)}</strong><small>${escapeHTML(item.item_referencia ? `${item.item_referencia.codigo} - ${item.item_referencia.descricao}` : '')}</small></span></label><div class="pedido-mrp-material-valores"><label>Peças<input class="pedido-mrp-material-quantidade" type="number" min="0.01" step="any" value="" oninput="atualizarMateriaisPedidoMRP()"></label><span>Consumo: <strong class="pedido-mrp-material-consumo">0,0000</strong></span><span>Compra: <strong class="pedido-mrp-material-total">0,0000</strong></span></div></div>`).join('');
    atualizarMateriaisPedidoMRP();
    calcularConsumoPedidoMRP();
    document.getElementById('pedido-mrp-produto-suggestions').classList.remove('visible');
}
function atualizarMateriaisPedidoMRP() {
    const selecionados = [...document.querySelectorAll('.pedido-mrp-material-row')].filter(linha => linha.querySelector('.pedido-mrp-material')?.checked).map(linha => ({ item: materiaisMRP.find(item => item.id === Number(linha.querySelector('.pedido-mrp-material').value)), quantidade: Number(linha.querySelector('.pedido-mrp-material-quantidade').value) })).filter(linha => linha.item);
    const totalMateriais = document.querySelectorAll('.pedido-mrp-material:checked').length;
    const resumo = document.getElementById('pedido-mrp-selecao-resumo');
    if (resumo) resumo.textContent = `${totalMateriais} selecionado${totalMateriais === 1 ? '' : 's'}`;
    selecionados.forEach(linha => {
        const consumo = Number(linha.item.consumo_por_peca || 0);
        linha.elemento = document.querySelector(`.pedido-mrp-material-row input[value="${linha.item.id}"]`)?.closest('.pedido-mrp-material-row');
        if (linha.elemento) {
            linha.elemento.querySelector('.pedido-mrp-material-consumo').textContent = consumo.toFixed(4).replace('.', ',');
            linha.elemento.querySelector('.pedido-mrp-material-total').textContent = (consumo * (linha.quantidade || 0)).toFixed(4).replace('.', ',');
        }
    });
    document.getElementById('pedido_mrp_material').value = selecionados.map(linha => linha.item.material_utilizado || linha.item.nome).join(' | ');
    document.getElementById('pedido_mrp_consumo').value = selecionados.reduce((total, linha) => total + Number(linha.item.consumo_por_peca || 0), 0).toFixed(4);
    calcularConsumoPedidoMRP();
}
function calcularConsumoPedidoMRP() {
    const consumo = parseFloat(document.getElementById('pedido_mrp_consumo').value) || 0;
    const quantidade = parseFloat(document.getElementById('pedido_mrp_quantidade').value) || 0;
    document.getElementById('pedido_mrp_consumo_total').value = (consumo * quantidade).toFixed(4);
}

function pesquisarMateriaisMRP(valor) {
    const termo = valor.trim().toLowerCase();
    const lista = document.getElementById('mrp-suggestions');
    const hint = document.getElementById('mrp-search-hint');
    mrpSuggestionIndex = -1;
    if (!lista) return;
    if (termo.length < 2) { lista.classList.remove('visible'); lista.innerHTML = ''; if (hint) hint.textContent = 'Digite pelo menos 2 caracteres para pesquisar.'; return; }
    const resultados = materiaisMRP.filter(material => material.nome.toLowerCase().includes(termo)).slice(0, 40);
    if (!resultados.length) { lista.innerHTML = '<div class="item-suggestions-empty">Nenhum material corresponde à pesquisa.</div>'; lista.classList.add('visible'); if (hint) hint.textContent = 'Cadastre o material no MRP antes de adicionar uma demanda.'; return; }
    lista.innerHTML = resultados.map((material, indice) => `<button type="button" class="item-suggestion" role="option" data-index="${indice}" data-value="${escapeHTML(material.nome)}"><span class="item-suggestion-code">Material ${escapeHTML(material.id)}</span><span class="item-suggestion-description">${escapeHTML(material.nome)}</span></button>`).join('');
    lista.classList.add('visible');
    lista.querySelectorAll('.item-suggestion').forEach(botao => botao.addEventListener('click', () => selecionarMaterialMRP(botao.dataset.value)));
    if (hint) hint.textContent = `${resultados.length}${resultados.length === 40 ? '+' : ''} material(is) encontrado(s).`;
}
function selecionarMaterialMRP(nome) { const input = document.getElementById('pedido_mrp_nome_input'); if (input) { input.value = nome; document.getElementById('mrp-search-clear').classList.add('visible'); } fecharSugestoesMRP(); }
function fecharSugestoesMRP() { const lista = document.getElementById('mrp-suggestions'); if (lista) { lista.classList.remove('visible'); lista.innerHTML = ''; } }
function navegarSugestoesMRP(event) { const lista = document.getElementById('mrp-suggestions'); const opcoes = lista ? [...lista.querySelectorAll('.item-suggestion')] : []; if (!opcoes.length) return; if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); mrpSuggestionIndex = (mrpSuggestionIndex + (event.key === 'ArrowDown' ? 1 : opcoes.length - 1)) % opcoes.length; opcoes.forEach((opcao, indice) => opcao.classList.toggle('active', indice === mrpSuggestionIndex)); opcoes[mrpSuggestionIndex].scrollIntoView({ block: 'nearest' }); } else if (event.key === 'Enter' && mrpSuggestionIndex >= 0) { event.preventDefault(); selecionarMaterialMRP(opcoes[mrpSuggestionIndex].dataset.value); } else if (event.key === 'Escape') fecharSugestoesMRP(); }
function configurarBuscaItemMRP(inputId, hiddenId, listaId, nomeId) {
    const input = document.getElementById(inputId);
    const hidden = document.getElementById(hiddenId);
    const lista = document.getElementById(listaId);
    if (!input || !hidden || !lista) return;
    const render = () => {
        const termo = input.value.trim().toLowerCase();
        if (termo.length < 2) { lista.classList.remove('visible'); lista.innerHTML = ''; return; }
        const resultados = itens.filter(item => `${item.codigo} ${item.descricao}`.toLowerCase().includes(termo)).slice(0, 30);
        lista.innerHTML = resultados.length ? resultados.map(item => `<button type="button" class="item-suggestion" data-id="${item.id}" data-value="${escapeHTML(item.codigo)} - ${escapeHTML(item.descricao)}"><span class="item-suggestion-code">${escapeHTML(item.codigo)}</span><span class="item-suggestion-description">${escapeHTML(item.descricao)}</span></button>`).join('') : '<div class="item-suggestions-empty">Nenhum item cadastrado encontrado.</div>';
        lista.classList.add('visible');
        lista.querySelectorAll('[data-id]').forEach(botao => botao.addEventListener('click', () => { hidden.value = botao.dataset.id; input.value = botao.dataset.value; const nome = document.getElementById(nomeId); if (nome) nome.value = botao.dataset.value.split(' - ').slice(1).join(' - '); lista.classList.remove('visible'); lista.innerHTML = ''; }));
    };
    input.addEventListener('input', () => { hidden.value = ''; render(); });
    input.addEventListener('keydown', event => { if (event.key === 'Escape') { lista.classList.remove('visible'); lista.innerHTML = ''; } });
}

function gerarSCdoMRP(id) {
    const mat = materiaisMRP.find(m => m.id === id);
    if (!mat || !mat.sugestao_compra) return;

    currentMrpIdParaSC = id;
    document.getElementById('parcial_mrp_id').value = id;
    document.getElementById('parcial-mrp-subtitulo').innerHTML = `Sugestão recomendada para <strong>${escapeHTML(mat.nome)}</strong>: <span style="color: var(--primary-color); font-weight: 600;">${escapeHTML(mat.sugestao_compra)} unidades</span>. Você pode ajustar abaixo para uma compra parcial:`;
    
    const inputQtd = document.getElementById('parcial_mrp_qtd');
    inputQtd.value = mat.sugestao_compra;

    document.getElementById('modalCompraParcialMRP').classList.add('active');
    setTimeout(() => { inputQtd.focus(); inputQtd.select(); }, 100);
}

function abrirCompraMRP(id) {
    const material = materiaisMRP.find(item => item.id === id);
    if (!material) return;
    document.getElementById('formCompraMRP').reset();
    document.getElementById('compra_mrp_id').value = id;
    document.getElementById('compra-mrp-material').textContent = material.nome;
    document.getElementById('compra_mrp_data').value = dataAgendaHoje();
    document.querySelector('input[name="compra_mrp_modo"][value="individual"]').checked = true;
    document.getElementById('compra-mrp-modo-group').style.display = '';
    alternarModoCompraMRP();
    document.getElementById('tituloModalCompraMRP').textContent = 'Registrar compra';
    document.getElementById('botaoSalvarCompraMRP').textContent = 'Registrar compra';
    document.getElementById('modalCompraMRP').classList.add('active');
    document.getElementById('compra_mrp_quantidade').focus();
}
function alternarModoCompraMRP() {
    const conjunta = document.querySelector('input[name="compra_mrp_modo"]:checked')?.value === 'conjunta';
    const quantidade = document.getElementById('compra_mrp_quantidade');
    const lista = document.getElementById('compra-mrp-conjunta-lista');
    if (!quantidade || !lista) return;
    quantidade.required = !conjunta;
    quantidade.closest('.form-group').style.display = conjunta ? 'none' : '';
    lista.style.display = conjunta ? '' : 'none';
    if (conjunta) {
        const material = materiaisMRP.find(item => item.id === Number(document.getElementById('compra_mrp_id').value));
        const chave = String(material?.material_utilizado || material?.nome || '').trim().toLowerCase();
        const relacionados = materiaisMRP.filter(item => !item.oculto && String(item.material_utilizado || item.nome).trim().toLowerCase() === chave);
        document.getElementById('compra-mrp-produtos').innerHTML = relacionados.map(item => `<label style="display:block; margin:8px 0;"><span style="display:block; margin-bottom:4px;">${escapeHTML(item.produto_nome || item.nome)}${item.cliente ? ` - ${escapeHTML(item.cliente)}` : ''}</span><input class="compra-mrp-qtd-produto" data-material-id="${item.id}" type="number" min="0.01" step="any" placeholder="Quantidade" style="width:100%;"><span>${(item.pedidos_mrp || []).map(pedido => `<label style="display:block; margin-top:4px;"><input class="compra-mrp-pedido-produto" data-material-id="${item.id}" value="${pedido.id}" type="checkbox"> Pedido ${pedido.id} - ${escapeHTML(pedido.produto)} (${(pedido.compra_ids || []).length} compra(s))</label>`).join('')}</span></label>`).join('');
        document.getElementById('compra-mrp-pedidos').style.display = 'none';
    } else {
        const material = materiaisMRP.find(item => item.id === Number(document.getElementById('compra_mrp_id').value));
        const pedidos = material?.pedidos_mrp || [];
        document.getElementById('compra-mrp-pedidos').style.display = '';
        document.getElementById('compra-mrp-pedidos-lista').innerHTML = pedidos.length ? pedidos.map(pedido => `<label style="display:block; margin:6px 0;"><input class="compra-mrp-pedido" value="${pedido.id}" type="checkbox"> Pedido ${pedido.id} - ${escapeHTML(pedido.produto)} (${quantidadeMRP(pedido.consumo_total)} unidades)</label>`).join('') : '<span style="color:var(--danger-color);">Não há pedidos disponíveis para este material.</span>';
    }
}
function editarCompraMRP(materialId, compraId) {
    const material = materiaisMRP.find(item => item.id === materialId);
    const compra = material?.compras?.find(item => item.id === compraId);
    if (!compra) return;
    document.getElementById('formCompraMRP').reset();
    document.getElementById('compra_mrp_id').value = `${materialId}:${compraId}`;
    document.getElementById('compra-mrp-material').textContent = material.nome;
    document.getElementById('compra_mrp_data').value = compra.data_compra;
    document.getElementById('compra_mrp_quantidade').min = compra.quantidade_recebida || 0.01;
    document.getElementById('compra_mrp_quantidade').value = compra.quantidade;
    document.getElementById('compra_mrp_fornecedor').value = compra.fornecedor;
    document.getElementById('tituloModalCompraMRP').textContent = 'Editar compra';
    document.getElementById('botaoSalvarCompraMRP').textContent = 'Salvar alterações';
    document.getElementById('compra-mrp-modo-group').style.display = 'none';
    document.getElementById('compra-mrp-conjunta-lista').style.display = 'none';
    document.getElementById('compra-mrp-pedidos').style.display = 'none';
    document.getElementById('compra_mrp_quantidade').closest('.form-group').style.display = '';
    document.getElementById('modalCompraMRP').classList.add('active');
}
function fecharCompraMRP() { document.getElementById('modalCompraMRP').classList.remove('active'); fecharSugestoesPO(); }
async function salvarCompraMRP(event) {
    event.preventDefault();
    const identificador = document.getElementById('compra_mrp_id').value;
    const [id, compraId] = identificador.split(':');
    try {
        const edicao = Boolean(compraId);
        const conjunta = !edicao && document.querySelector('input[name="compra_mrp_modo"]:checked')?.value === 'conjunta';
        const dados = { data_compra: document.getElementById('compra_mrp_data').value, fornecedor: document.getElementById('compra_mrp_fornecedor').value };
        if (conjunta) dados.materiais = [...document.querySelectorAll('.compra-mrp-qtd-produto')].filter(campo => campo.value).map(campo => ({ material_id: Number(campo.dataset.materialId), quantidade: campo.value, pedido_ids: [...document.querySelectorAll(`.compra-mrp-pedido-produto[data-material-id="${campo.dataset.materialId}"]:checked`)].map(pedido => Number(pedido.value)) }));
        else { dados.quantidade = document.getElementById('compra_mrp_quantidade').value; dados.pedido_ids = [...document.querySelectorAll('.compra-mrp-pedido:checked')].map(pedido => Number(pedido.value)); }
        if (conjunta && !dados.materiais.length) { alert('Informe a quantidade de pelo menos um produto.'); return; }
        const resposta = await fetch(`/api/v1/planejamento/${id}/compras${edicao ? `/${compraId}` : ''}`, { method: edicao ? 'PUT' : 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(dados) });
        const tipoResposta = resposta.headers.get('content-type') || '';
        const resultado = tipoResposta.includes('application/json') ? await resposta.json() : {};
        if (!resposta.ok) { alert(resultado.erro || `Não foi possível registrar a compra (HTTP ${resposta.status}). Reinicie o servidor e tente novamente.`); return; }
        fecharCompraMRP(); await carregarMRP(); mostrarAviso(edicao ? 'Compra atualizada com sucesso.' : 'Compra registrada com sucesso.', 'success');
    } catch (erro) {
        console.error(erro);
        alert('Não foi possível conectar ao servidor.');
    }
}
async function excluirCompraMRP(materialId, compraId) {
    if (!await confirmarAcao('Confirma a exclusão desta compra registrada? Esta ação não pode ser desfeita.')) return;
    const resposta = await fetch(`/api/v1/planejamento/${materialId}/compras/${compraId}`, { method: 'DELETE' });
    const resultado = await resposta.json();
    if (!resposta.ok) { alert(resultado.erro || 'Não foi possível excluir a compra.'); return; }
    await carregarMRP();
}
async function excluirProdutoMRP(id, nome) {
    if (!await confirmarAcao(`Confirma a exclusão do produto "${nome}"?\n\nAs compras vinculadas também serão excluídas. Esta ação não pode ser desfeita.`)) return;
    const resposta = await fetch(`/api/v1/planejamento/${id}`, { method: 'DELETE' });
    const resultado = await resposta.json();
    if (!resposta.ok) { alert(resultado.erro || 'Não foi possível excluir o produto.'); return; }
    await carregarMRP();
}
function abrirRecebimentoMRP(materialId, compraId) {
    const material = materiaisMRP.find(item => item.id === materialId);
    const compra = material?.compras?.find(item => item.id === compraId);
    if (!compra) return;
    document.getElementById('formReceberCompraMRP').reset();
    document.getElementById('receber_mrp_id').value = materialId;
    document.getElementById('receber_compra_id').value = compraId;
    document.getElementById('receber-mrp-detalhes').textContent = `${material.nome} | ${compra.fornecedor} | Saldo pendente: ${quantidadeMRP(compra.saldo_fornecedor)}`;
    document.getElementById('receber_mrp_data').value = dataAgendaHoje();
    document.getElementById('receber_mrp_quantidade').max = compra.saldo_fornecedor;
    document.getElementById('receber_mrp_quantidade').value = compra.saldo_fornecedor;
    document.getElementById('modalReceberCompraMRP').classList.add('active');
}
function fecharRecebimentoMRP() { document.getElementById('modalReceberCompraMRP').classList.remove('active'); }
async function salvarRecebimentoMRP(event) {
    event.preventDefault();
    const materialId = document.getElementById('receber_mrp_id').value;
    const compraId = document.getElementById('receber_compra_id').value;
    const resposta = await fetch(`/api/v1/planejamento/${materialId}/compras/${compraId}/receber`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ data_recebimento: document.getElementById('receber_mrp_data').value, quantidade_recebida: document.getElementById('receber_mrp_quantidade').value }) });
    const resultado = await resposta.json();
    if (!resposta.ok) { alert(resultado.erro || 'Não foi possível registrar o recebimento.'); return; }
    fecharRecebimentoMRP(); await carregarMRP();
}
function pesquisarFornecedorCompraMRP(valor) {
    const lista = document.getElementById('compra-mrp-fornecedor-suggestions');
    const termo = valor.trim().toLowerCase();
    if (!lista) return;
    if (termo.length < 2) { lista.classList.remove('visible'); lista.innerHTML = ''; return; }
    const resultados = fornecedores.filter(fornecedor => `${fornecedor.razao_social} ${fornecedor.nome_fantasia || ''} ${fornecedor.codigo || ''} ${fornecedor.cnpj || ''}`.toLowerCase().includes(termo)).slice(0, 30);
    lista.innerHTML = resultados.length ? resultados.map(fornecedor => `<button type="button" class="item-suggestion" data-value="${escapeHTML(fornecedor.razao_social)}"><span class="item-suggestion-code">${escapeHTML(fornecedor.codigo || fornecedor.cnpj || 'Fornecedor')}</span><span class="item-suggestion-description">${escapeHTML(fornecedor.razao_social)}</span></button>`).join('') : '<div class="item-suggestions-empty">Nenhum fornecedor encontrado.</div>';
    lista.classList.add('visible');
    lista.querySelectorAll('[data-value]').forEach(botao => botao.addEventListener('click', () => { document.getElementById('compra_mrp_fornecedor').value = botao.dataset.value; lista.classList.remove('visible'); lista.innerHTML = ''; }));
}

function closeModalCompraParcial() {
    document.getElementById('modalCompraParcialMRP').classList.remove('active');
    currentMrpIdParaSC = null;
}

async function confirmarGerarSCParcial(e) {
    e.preventDefault();
    const id = currentMrpIdParaSC;
    const qtdFinal = parseFloat(document.getElementById('parcial_mrp_qtd').value);
    
    if (!id || isNaN(qtdFinal) || qtdFinal <= 0) {
        alert("Informe uma quantidade válida.");
        return;
    }

    const mat = materiaisMRP.find(m => m.id === id);
    if (!mat) return;

    const payload = { item: mat.nome, quantidade: qtdFinal, setor: 'PCP' };
    try {
        const res = await fetch('/api/v1/solicitacoes', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(payload) 
        });
        if (res.ok) { 
            closeModalCompraParcial();
            await carregarSolicitacoes(true); 
        } else {
            const err = await res.json();
            alert("Erro: " + (err.erro || "Falha ao gerar SC"));
        }
    } catch (err) { 
        console.error(err); 
    }
}

async function ocultarMRP(id) {
    if(await confirmarAcao("Deseja ocultar este material da visualização principal?")) {
        try {
            const res = await fetch(`/api/v1/planejamento/${id}`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ oculto: true }) });
            if (res.ok) { await carregarMRP(); }
        } catch (err) { console.error(err); }
    }
}

// === LÓGICAS DE ROTAS ===
async function submitNovaRota(e) {
    e.preventDefault();
    const endereco = document.getElementById('rota_endereco').value.trim();
    const destino = document.getElementById('rota_destino').value.trim();
    const localizacaoInformada = document.getElementById('rota_localizacao_mapa').value.trim();
    const payload = {
        data_prevista: document.getElementById('rota_data').value,
        motorista: document.getElementById('rota_motorista').value,
        destino_fornecedor: destino,
        endereco,
        localizacao_mapa: localizacaoInformada || (endereco ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${endereco}, ${destino}`)}` : ''),
        po_ref: document.getElementById('rota_po').value,
        observacoes: document.getElementById('rota_obs').value
    };
    const id = document.getElementById('rota_edit_id').value;
    try {
        const res = await fetch(id ? `/api/v1/rotas/${id}` : '/api/v1/rotas', { method: id ? 'PUT' : 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) });
        const resultado = await res.json();
        if (res.ok) { closeModalNovaRota(); await carregarRotas(); }
        else alert(resultado.erro || 'Não foi possível salvar a rota.');
    } catch (err) { console.error(err); }
}

async function alterarStatusRota(id, status) {
    try {
        const res = await fetch(`/api/v1/rotas/${id}/status`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ status }) });
        if (res.ok) { await carregarRotas(); }
    } catch (err) { console.error(err); }
}

// === COTAÇÕES ===
function formatarMoeda(valor) { return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function obterItensCotacao() {
    const sc = solicitacoes.find(item => item.db_id === currentScDbId);
    if (sc && Array.isArray(sc.itens_detalhados) && sc.itens_detalhados.length) return sc.itens_detalhados.filter(item => (item.status || 'pendente') === 'pendente');
    return [{ item: sc?.item || '', quantidade: sc?.quantidade || 1 }];
}
function parseNumeroCotacao(valor) {
    const texto = String(valor ?? '').trim().replace(/\s/g, '');
    if (!texto) return 0;
    if (texto.includes(',')) return Number(texto.replace(/\./g, '').replace(',', '.')) || 0;
    if ((texto.match(/\./g) || []).length > 1) return Number(texto.replace(/\./g, '')) || 0;
    return Number(texto) || 0;
}
function formatarPrecoCotacao(valor) { return Number(valor || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 }); }
function desformatarPrecoCotacao(campo) {
    const valor = parseNumeroCotacao(campo.value);
    campo.value = valor ? valor.toFixed(4).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',') : '';
}
function formatarCampoPrecoCotacao(campo) {
    const valor = parseNumeroCotacao(campo.value);
    campo.value = valor ? formatarPrecoCotacao(valor) : '';
}
function normalizarPrecoCotacao(valor) {
    const numero = parseNumeroCotacao(valor);
    return numero > 0 ? numero.toFixed(4) : '';
}
function atualizarTotalCotacao() {
    let total = 0;
    document.querySelectorAll('.cotacao-item-row').forEach(linha => {
        if (linha.querySelector('.cotacao-ignorar-item')?.checked) return;
        const quantidade = Number(linha.querySelector('.cotacao-quantidade')?.value || 0);
        const unitario = parseNumeroCotacao(linha.querySelector('.cotacao-unitario')?.value);
        const totalItem = quantidade * unitario;
        total += totalItem;
        const campoTotal = linha.querySelector('.cotacao-item-total');
        if (campoTotal) campoTotal.textContent = formatarMoeda(totalItem);
    });
    const preview = document.getElementById('cotacao-total-preview');
    if (preview) preview.textContent = `Total: ${formatarMoeda(total)}`;
}
function adicionarLinhaItemCotacao(item = '', quantidade = '', valorUnitario = '', unidade = '') {
    const container = document.getElementById('itens-cotacao-list');
    if (!container) return;
    const linha = document.createElement('div');
    linha.className = 'cotacao-item-row';
    linha.style.cssText = '';
    linha.innerHTML = `<div class="cotacao-item-campo"><div class="cotacao-item-cabecalho"><span>Item</span><label><input class="cotacao-ignorar-item" type="checkbox"> Não comprar</label></div><input class="cotacao-item-nome" value="${escapeAttribute(item)}" style="width:100%;" readonly></div><label><span style="display:block; font-size:.72rem; color:var(--text-body);">Qtd.</span><input class="cotacao-quantidade" type="number" min="0.01" step="0.01" value="${escapeAttribute(quantidade)}" required style="width:100%;"></label><label><span style="display:block; font-size:.72rem; color:var(--text-body);">Unid.</span><input class="cotacao-unidade" value="${escapeAttribute(unidade)}" placeholder="UN, KG, CX..." maxlength="30" required style="width:100%;"></label><label><span style="display:block; font-size:.72rem; color:var(--text-body);">Preço unit.</span><input class="cotacao-unitario" type="text" inputmode="decimal" placeholder="0,0000" value="${escapeAttribute(valorUnitario)}" required style="width:100%;"></label><label style="min-width:0;"><span style="display:block; font-size:.72rem; color:var(--text-body);">Fornecedor</span><div class="cotacao-fornecedor-autocomplete" style="position:relative;"><input class="cotacao-fornecedor" required autocomplete="off" placeholder="Busque por nome, código ou CNPJ..." style="width:100%;"><div class="item-suggestions" role="listbox"></div></div></label><label><span style="display:block; font-size:.72rem; color:var(--text-body);">Prazo entrega</span><input class="cotacao-prazo" placeholder="5 dias úteis" required style="width:100%;"></label><label><span style="display:block; font-size:.72rem; color:var(--text-body);">Pagamento</span><select class="cotacao-pagamento" required style="width:100%;"><option value="A vista">À vista</option><option value="Boleto - 30 dias">Boleto - 30 dias</option><option value="Boleto - 60 dias">Boleto - 60 dias</option><option value="Cartão">Cartão</option><option value="Pix">Pix</option></select></label>`;
    container.appendChild(linha);
    linha.querySelectorAll('input').forEach(input => input.addEventListener('input', atualizarTotalCotacao));
    linha.querySelector('.cotacao-ignorar-item').addEventListener('change', event => alternarItemIgnoradoCotacao(linha, event.target.checked));
    const campoFornecedor = linha.querySelector('.cotacao-fornecedor');
    campoFornecedor.addEventListener('input', () => pesquisarFornecedorCotacao(campoFornecedor));
    campoFornecedor.addEventListener('keydown', event => navegarSugestoesFornecedorCotacao(event, campoFornecedor));
    campoFornecedor.addEventListener('focus', () => pesquisarFornecedorCotacao(campoFornecedor));
    const campoPreco = linha.querySelector('.cotacao-unitario');
    campoPreco.addEventListener('focus', () => desformatarPrecoCotacao(campoPreco));
    campoPreco.addEventListener('blur', () => formatarCampoPrecoCotacao(campoPreco));
    atualizarTotalCotacao();
}
function alternarItemIgnoradoCotacao(linha, ignorado) {
    linha.classList.toggle('cotacao-item-ignorado', ignorado);
    linha.querySelector('.cotacao-item-nome').style.textDecoration = ignorado ? 'line-through' : '';
    linha.querySelectorAll('.cotacao-quantidade, .cotacao-unidade, .cotacao-unitario, .cotacao-fornecedor, .cotacao-prazo, .cotacao-pagamento').forEach(campo => {
        campo.disabled = ignorado;
        campo.required = !ignorado;
    });
    if (ignorado) {
        const sugestoes = linha.querySelector('.cotacao-fornecedor-autocomplete .item-suggestions');
        if (sugestoes) { sugestoes.classList.remove('visible'); sugestoes.innerHTML = ''; }
    }
    atualizarTotalCotacao();
}
function normalizarBuscaFornecedorCotacao(valor) { return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function pesquisarFornecedorCotacao(campo) {
    const lista = campo.closest('.cotacao-fornecedor-autocomplete')?.querySelector('.item-suggestions');
    if (!lista) return;
    campo.dataset.suggestionIndex = '-1';
    const termo = normalizarBuscaFornecedorCotacao(campo.value.trim());
    if (termo.length < 2) { lista.classList.remove('visible'); lista.innerHTML = ''; return; }
    const resultados = fornecedores.filter(fornecedor => normalizarBuscaFornecedorCotacao(`${fornecedor.razao_social} ${fornecedor.nome_fantasia || ''} ${fornecedor.codigo || ''} ${fornecedor.cnpj || ''}`).includes(termo)).slice(0, 30);
    lista.innerHTML = resultados.length ? resultados.map(fornecedor => `<button type="button" class="item-suggestion" role="option" data-value="${escapeHTML(fornecedor.razao_social)}"><span class="item-suggestion-code">${escapeHTML(fornecedor.codigo || fornecedor.cnpj || 'Fornecedor')}</span><span class="item-suggestion-description">${escapeHTML(fornecedor.razao_social)}${fornecedor.nome_fantasia ? ` (${escapeHTML(fornecedor.nome_fantasia)})` : ''}</span></button>`).join('') : '<div class="item-suggestions-empty">Nenhum fornecedor encontrado.</div>';
    lista.classList.add('visible');
    lista.querySelectorAll('[data-value]').forEach(botao => botao.addEventListener('click', () => {
        campo.value = botao.dataset.value;
        lista.classList.remove('visible');
        lista.innerHTML = '';
    }));
}
function navegarSugestoesFornecedorCotacao(event, campo) {
    const lista = campo.closest('.cotacao-fornecedor-autocomplete')?.querySelector('.item-suggestions');
    const opcoes = lista ? [...lista.querySelectorAll('.item-suggestion')] : [];
    if (!opcoes.length) { if (event.key === 'Escape') { lista?.classList.remove('visible'); lista.innerHTML = ''; } return; }
    let indice = Number(campo.dataset.suggestionIndex || -1);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        indice = indice < 0
            ? (event.key === 'ArrowDown' ? 0 : opcoes.length - 1)
            : (indice + (event.key === 'ArrowDown' ? 1 : opcoes.length - 1)) % opcoes.length;
        opcoes.forEach((opcao, posicao) => opcao.classList.toggle('active', posicao === indice));
        opcoes[indice].scrollIntoView({ block: 'nearest' });
        campo.dataset.suggestionIndex = String(indice);
    } else if (event.key === 'Enter' && indice >= 0) {
        event.preventDefault();
        opcoes[indice].click();
    } else if (event.key === 'Escape') {
        lista.classList.remove('visible');
        lista.innerHTML = '';
    }
}
function fecharSugestoesFornecedoresCotacao() { document.querySelectorAll('.cotacao-fornecedor-autocomplete .item-suggestions').forEach(lista => { lista.classList.remove('visible'); lista.innerHTML = ''; }); }
async function openModalCotacao() { if (!fornecedores.length) await carregarFornecedores(); const container = document.getElementById('itens-cotacao-list'); if (container) { container.innerHTML = ''; obterItensCotacao().forEach(item => adicionarLinhaItemCotacao(item.item, item.quantidade, '', item.unidade || '')); } document.getElementById('modalCotacao').classList.add('active'); }
async function submitFormCotacao(e) { e.preventDefault(); if (cotacaoEnviando || (currentUser && (currentUser.perfil === 'solicitante' || currentUser.perfil === 'estoque'))) return; cotacaoEnviando = true; const botao = e.submitter || e.target.querySelector('button[type="submit"]'); const textoOriginal = botao ? botao.textContent : ''; if (botao) { botao.disabled = true; botao.textContent = 'Salvando...'; } const itens = [...document.querySelectorAll('.cotacao-item-row')].map(linha => { const ignorado = linha.querySelector('.cotacao-ignorar-item').checked; if (ignorado) return { item: linha.querySelector('.cotacao-item-nome').value, nao_comprar: true }; return { item: linha.querySelector('.cotacao-item-nome').value, quantidade: linha.querySelector('.cotacao-quantidade').value, unidade: linha.querySelector('.cotacao-unidade').value, valor_unitario: normalizarPrecoCotacao(linha.querySelector('.cotacao-unitario').value), fornecedor: linha.querySelector('.cotacao-fornecedor').value, prazo_entrega: linha.querySelector('.cotacao-prazo').value, condicao_pgto: linha.querySelector('.cotacao-pagamento').value }; }); const payload = { sc_db_id: currentScDbId, itens }; try { const r = await fetch('/api/v1/cotacoes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const resultado = await r.json(); if (r.ok) { closeModalCotacao(); await carregarSolicitacoes(true); await abrirCotacoes(document.getElementById('cotacao-sc-id').innerText, currentScDbId); } else { alert(resultado.erro || 'Não foi possível salvar a cotação.'); } } catch (e) { console.error(e); alert('Não foi possível salvar a cotação.'); } finally { cotacaoEnviando = false; if (botao) { botao.disabled = false; botao.textContent = textoOriginal; } } }
async function aprovarCotacao(scDbId, cotacaoId) { if (currentUser && (currentUser.perfil === 'solicitante' || currentUser.perfil === 'estoque')) return; try { const r = await fetch(`/api/v1/solicitacoes/${scDbId}/aprovar`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cotacao_id: cotacaoId }) }); if (r.ok) { alert("Cotação aprovada!"); await carregarSolicitacoes(true); await carregarPedidos(true); await carregarKPIs(); closeModalDetalhes(); switchView('pedidos', document.getElementById('nav-pedidos')); } } catch (e) { console.error(e); } }
async function abrirCotacoes(scId, scDbId) { closeModalDetalhes(); document.getElementById('cotacao-sc-id').innerText = escapeHTML(scId); currentScDbId = scDbId; document.getElementById('cotacoes-table-body').innerHTML = '<tr><td colspan="6" style="text-align:center;">Carregando...</td></tr>'; switchView('cotacoes'); try { const r = await fetch(`/api/v1/cotacoes/${scDbId}`); if (r.ok) { renderCotacoesTable(await r.json()); } else { document.getElementById('cotacoes-table-body').innerHTML = '<tr><td colspan="6" style="text-align:center;">Não foi possível carregar as cotações.</td></tr>'; } } catch (e) { console.error(e); document.getElementById('cotacoes-table-body').innerHTML = '<tr><td colspan="6" style="text-align:center;">Não foi possível carregar as cotações.</td></tr>'; } }
function renderCotacoesTable(lista) { const tbody = document.getElementById('cotacoes-table-body'); tbody.innerHTML = ''; const isLido = currentUser && (currentUser.perfil === 'solicitante' || currentUser.perfil === 'estoque'); if (lista.length === 0) { tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">Nenhuma cotação.</td></tr>`; } else { lista.forEach((c, index) => { const isBest = index === 0; const itensHtml = (c.itens || []).map(item => `<div style="margin-bottom:4px;"><strong>${escapeHTML(item.item)}</strong><br><small>Qtd: ${escapeHTML(item.quantidade)} ${escapeHTML(item.unidade || 'UN')} x ${escapeHTML(item.valor_unitario || formatarMoeda(item.valor_unitario_raw))} = <strong>${escapeHTML(item.valor_total || formatarMoeda(item.valor_total_raw))}</strong><br>Fornecedor: ${escapeHTML(item.fornecedor || c.fornecedor)} | Entrega: ${escapeHTML(item.prazo_entrega || c.prazo_entrega)} | Pagamento: ${escapeHTML(item.condicao_pgto || c.condicao_pgto)}</small></div>`).join(''); tbody.innerHTML += `<tr style="${isBest ? 'background-color: rgba(59, 130, 246, 0.1);' : ''}"><td style="${isBest ? 'font-weight: bold; color: var(--primary-color);' : ''}">${escapeHTML(c.fornecedor)} ${isBest ? '👑' : ''}</td><td>${itensHtml}</td><td><strong>${escapeHTML(c.valor_total)}</strong></td><td>${escapeHTML(c.prazo_entrega)}</td><td>${escapeHTML(c.condicao_pgto)}</td><td>${isLido ? '-' : `<button onclick="aprovarCotacao(${currentScDbId}, ${c.id})" class="btn" style="padding:6px 12px; font-size:0.85rem;">Aprovar & Gerar PO</button>`}</td></tr>`; }); } }

// === KANBAN ===
function normalizarBuscaKanban(valor) {
    return String(valor ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function valoresBuscaKanban(valor) {
    if (valor === null || valor === undefined) return [];
    if (Array.isArray(valor)) return valor.flatMap(valoresBuscaKanban);
    if (typeof valor === 'object') return Object.values(valor).flatMap(valoresBuscaKanban);
    return [String(valor)];
}

function filtrarKanban(coluna, termo) {
    const cards = document.querySelectorAll(`#kb-${coluna} .kb-card`);
    const busca = normalizarBuscaKanban(termo).trim();
    cards.forEach(card => {
        card.hidden = Boolean(busca) && !normalizarBuscaKanban(card.dataset.search).includes(busca);
    });
}

function aplicarFiltrosKanban() {
    ['solicitacao', 'cotacao', 'pedido', 'transito', 'entregue'].forEach(coluna => {
        const campo = document.querySelector(`#kb-${coluna} .kb-search`);
        if (campo) filtrarKanban(coluna, campo.value);
    });
}

function renderKanban() {
    const novaAssinatura = JSON.stringify([
        solicitacoes.map(sc => [sc.id, sc.status, sc.item, sc.quantidade]),
        pedidos.map(po => [po.id, po.status, po.item, po.valor_total, po.data_entrega, po.data_prevista, po.atrasado])
    ]);
    if (novaAssinatura === assinaturaKanban) return;
    const scrolls = {};
    ['solicitacao', 'cotacao', 'pedido', 'transito', 'entregue'].forEach(coluna => {
        const cards = document.querySelector(`#kb-${coluna} .kb-cards`);
        if (cards) scrolls[coluna] = cards.scrollTop;
    });
    assinaturaKanban = novaAssinatura;
    const cols = ['solicitacao', 'cotacao', 'pedido', 'transito', 'entregue'];
    cols.forEach(c => { const el = document.getElementById(`kb-${c}`); if(el) el.querySelector('.kb-cards').innerHTML = ''; });
    let count = {sc:0, cot:0, ped:0, trans:0, ent:0};
    const templateCard = document.getElementById('template-kanban-card');

    function criarCartaoDOM(itemObj, tipo, isAtrasado = false) {
        if (!templateCard) return document.createElement('div');
        const clone = templateCard.content.cloneNode(true);
        const cardDiv = clone.querySelector('.kb-card');
        cardDiv.dataset.search = normalizarBuscaKanban(valoresBuscaKanban(itemObj).join(' '));
        if (isAtrasado) cardDiv.classList.add('atrasado');
        cardDiv.onclick = () => abrirDetalhesCartao(itemObj.id, tipo);
        clone.querySelector('.card-id-text').textContent = itemObj.id;
        
        if (isAtrasado) {
            const badgeSpan = document.createElement('span');
            badgeSpan.className = 'badge-atrasado'; badgeSpan.textContent = 'Atrasado';
            clone.querySelector('.badge-atrasado-container').appendChild(badgeSpan);
        }

        const descEl = clone.querySelector('.kb-card-desc');
        if (tipo === 'PO') {
            descEl.textContent = itemObj.item;
            const dataExibicao = itemObj.data_entrega || itemObj.data_prevista;
            if (dataExibicao) {
                const dataDiv = document.createElement('div');
                dataDiv.className = 'card-data-entrega';
                dataDiv.style.cssText = 'font-size: 0.75rem; color: var(--primary-color); font-weight: 600; margin-top: 6px; padding: 4px; background: rgba(59, 130, 246, 0.1); border-radius: 4px; display: inline-block;';
                dataDiv.innerHTML = `📅 Prev: ${escapeHTML(dataExibicao)}`;
                descEl.after(dataDiv);
            }
            clone.querySelector('.card-footer-left').textContent = itemObj.valor_total;
            clone.querySelector('.card-footer-right').textContent = `Fornecedor: ${itemObj.fornecedor}`;
        } else {
            const itensLista = String(itemObj.item || '').split(';').map(parte => parte.trim()).filter(Boolean);
            if (itensLista.length > 1) {
                descEl.style.cssText = 'display: flex; flex-direction: column; gap: 4px; max-height: 96px; overflow-y: auto; padding-right: 6px;';
                descEl.innerHTML = itensLista.map(item => `<div style="font-size:0.76rem; line-height:1.35;">• ${escapeHTML(item)}</div>`).join('');
            } else {
                descEl.textContent = itemObj.item;
            }
            const quantidadeTotal = Array.isArray(itemObj.itens)
                ? itemObj.itens.reduce((total, item) => total + Number(item.quantidade || 0), 0)
                : Number(itemObj.quantidade || 0);
            clone.querySelector('.card-footer-left').textContent = `Qtd total: ${quantidadeTotal.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`;
            clone.querySelector('.card-footer-right').textContent = itemObj.solicitante || itemObj.setor || 'Solicitante';
        }
        return clone;
    }

    solicitacoes.forEach(sc => {
        if (sc.status === 'cancelado') return; const cardDOM = criarCartaoDOM(sc, 'SC');
        if (sc.status === 'pendente') { count.sc++; document.getElementById('kb-solicitacao').querySelector('.kb-cards').appendChild(cardDOM); } 
        else if (sc.status === 'cotacao') { count.cot++; document.getElementById('kb-cotacao').querySelector('.kb-cards').appendChild(cardDOM); }
    });
    pedidos.forEach(po => {
        if (po.status === 'cancelado') return; let target = 'pedido';
        if (po.status === 'gerado' || po.status === 'aprovado') { count.ped++; target = 'pedido'; }
        else if (po.status === 'transito') { count.trans++; target = 'transito'; }
        else if (po.status === 'entregue') { count.ent++; target = 'entregue'; }
        const cardDOM = criarCartaoDOM(po, 'PO', po.atrasado);
        document.getElementById(`kb-${target}`).querySelector('.kb-cards').appendChild(cardDOM);
    });

    document.getElementById('count-sc').textContent = count.sc; document.getElementById('count-cot').textContent = count.cot;
    document.getElementById('count-ped').textContent = count.ped; document.getElementById('count-trans').textContent = count.trans;
    document.getElementById('count-ent').textContent = count.ent;
    Object.entries(scrolls).forEach(([coluna, scrollTop]) => {
        const cards = document.querySelector(`#kb-${coluna} .kb-cards`);
        if (cards) cards.scrollTop = scrollTop;
    });
    aplicarFiltrosKanban();
}

// === LÓGICA DO CARTÃO (EXPERIÊNCIA TRELLO) ===
async function abrirDetalhesCartao(id, tipo) {
    let itemObj = tipo === 'SC' ? solicitacoes.find(s => s.id === id) : pedidos.find(p => p.id === id);
    if (!itemObj) return;

    currentDetalhes = { id: id, tipo: tipo, db_id: itemObj.db_id, etiquetas: itemObj.etiquetas && itemObj.etiquetas.toLowerCase().split(',').some(e => e.trim() === 'emergencia') ? ['emergencia'] : [] };
    document.getElementById('detalhes-titulo').innerText = `${tipo === 'SC' ? 'Solicitação' : 'Pedido'}: ${escapeHTML(itemObj.id)}`;
    
    const itensDetalhadosSC = itemObj.itens_detalhados?.length
        ? itemObj.itens_detalhados
        : String(itemObj.item || '').split(';').map(item => item.trim()).filter(Boolean).map((item, indice, lista) => ({ item, quantidade: lista.length === 1 ? itemObj.quantidade : null }));
    const isLeitura = currentUser && (currentUser.perfil === 'solicitante' || currentUser.perfil === 'estoque');
    const podeEditarSC = tipo === 'SC' && !['cancelado', 'aprovado', 'entregue'].includes(itemObj.status) && (!isLeitura || itemObj.usuario_id === currentUser?.id);
    const linhasItensSC = itensDetalhadosSC.map((item, indice) => {
        const status = item.status || 'pendente';
        const concluido = status === 'concluido';
        const aprovado = status === 'aprovado';
        const naoComprar = status === 'nao_comprar';
        const statusItem = concluido ? 'Concluído' : aprovado ? 'Aprovado' : naoComprar ? 'Não comprar' : 'Pendente';
        const acaoNaoComprar = podeEditarSC && (status === 'pendente' || naoComprar)
            ? '<button type="button" class="sc-toggle-nao-comprar" aria-pressed="' + naoComprar + '" aria-label="' + (naoComprar ? 'Reativar item para compra' : 'Marcar item como não comprar') + '" title="' + (naoComprar ? 'Reativar para compra' : 'Marcar como não comprar') + '" onclick="alternarStatusCompraSC(' + indice + ')"><span aria-hidden="true">' + (naoComprar ? '↶' : '⊘') + '</span></button>'
            : '';
        const statusClasse = concluido ? 'concluido' : aprovado ? 'aprovado' : naoComprar ? 'nao-comprar' : 'pendente';
        return '<tr data-sc-item="' + indice + '" data-status-item="' + escapeAttribute(status) + '" style="' + (concluido || aprovado ? 'opacity:0.65;' : '') + '">' +
            '<td style="padding:8px; border-bottom:1px solid var(--border-color); white-space:nowrap;"><span class="codigo-item-cartao">' + escapeHTML(item.codigo || 'Não cadastrado') + '</span></td>' +
            '<td class="sc-item-descricao" style="padding:8px; border-bottom:1px solid var(--border-color);' + (naoComprar ? ' text-decoration:line-through;' : '') + '">' + escapeHTML(item.item) + '</td>' +
            '<td style="padding:8px; text-align:right; border-bottom:1px solid var(--border-color);"><input class="sc-quantidade-edicao" data-indice="' + indice + '" type="number" min="0.01" step="any" value="' + (item.quantidade == null ? '' : escapeAttribute(item.quantidade)) + '" placeholder="Informe" style="width:110px; text-align:right;" ' + (item.quantidade == null || concluido || aprovado || naoComprar ? '' : 'required') + ' ' + (concluido || aprovado || naoComprar ? 'disabled' : '') + '></td>' +
            '<td style="padding:8px; text-align:center; border-bottom:1px solid var(--border-color);"><div class="sc-status-acoes"><span class="status-item-cartao sc-status-label ' + statusClasse + '">' + statusItem + '</span>' + acaoNaoComprar + '</div></td></tr>';
    }).join('');
    const tabelaItensSC = '<div style="overflow-x:auto;"><table style="width:100%; border-collapse:collapse; margin-bottom:14px;">' +
        '<thead><tr><th style="text-align:left; padding:8px; border-bottom:1px solid var(--border-color);">Código</th><th style="text-align:left; padding:8px; border-bottom:1px solid var(--border-color);">Item / Serviço</th><th style="text-align:right; padding:8px; border-bottom:1px solid var(--border-color);">Quantidade</th><th style="text-align:center; padding:8px; border-bottom:1px solid var(--border-color);">Status</th></tr></thead>' +
        '<tbody>' + linhasItensSC + '</tbody><tfoot><tr><th colspan="2" style="padding:8px; text-align:left;">Total</th><th id="sc-total-edicao" style="padding:8px; text-align:right;">' + escapeHTML(Number(itemObj.quantidade || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })) + '</th><th></th></tr></tfoot></table></div>';
    const itemNomeFormatado = String(nomeItemCompleto(itemObj.item) || 'Item não informado').replace(/\s+/g, ' ').trim();
    const itensPedidoPO = tipo === 'PO'
        ? (Array.isArray(itemObj.itens) && itemObj.itens.length
            ? itemObj.itens
            : [{ item: itemNomeFormatado, quantidade_solicitada: null, quantidade_pedida: itemObj.quantidade }])
        : [];
    const quantidadeItensNoPedido = itensPedidoPO.filter(item =>
        item.incluido_no_pedido === true
        || (item.incluido_no_pedido == null && item.quantidade_pedida != null)
    ).length;
    const quantidadeItensPendentesSC = itensPedidoPO.length - quantidadeItensNoPedido;
    const formatarQuantidadePedido = quantidade => {
        if (quantidade === null || quantidade === undefined || quantidade === '') return '—';
        const numero = Number(quantidade);
        return Number.isFinite(numero)
            ? numero.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
            : '—';
    };
    const listaItensPedidoPO = `<section class="detail-items-section" aria-label="Itens da solicitação e do pedido">
        <div class="detail-items-heading">
            <div><h3>Itens da solicitação</h3><p>Comparação entre o solicitado e este pedido</p></div>
            <span class="detail-items-count">${quantidadeItensNoPedido} no pedido · ${quantidadeItensPendentesSC} continuam na solicitação</span>
        </div>
        <div class="detail-items-list" role="table" aria-label="Itens da solicitação e quantidades">
            <div class="detail-items-header" role="row">
                <span role="columnheader">Item solicitado</span>
                <span role="columnheader">Quantidade solicitada</span>
                <span role="columnheader">Quantidade pedida</span>
            </div>
            ${itensPedidoPO.map((item, indice) => {
            const incluidoNoPedido = item.incluido_no_pedido === true
                || (item.incluido_no_pedido == null && item.quantidade_pedida != null);
            const quantidadeSolicitada = formatarQuantidadePedido(item.quantidade_solicitada);
            const quantidadePedida = incluidoNoPedido
                ? formatarQuantidadePedido(item.quantidade_pedida)
                : '—';
            return `<div class="detail-items-row${incluidoNoPedido ? ' is-included' : ' is-not-included'}" role="row">
                <span class="detail-item-name" role="cell"><span class="detail-item-index">${indice + 1}</span>${escapeHTML(item.item || 'Item não informado')}</span>
                <span class="detail-item-quantity" role="cell"><small>Solicitada</small>${escapeHTML(quantidadeSolicitada)}${item.unidade ? ` ${escapeHTML(item.unidade)}` : ''}</span>
                <span class="detail-item-quantity${incluidoNoPedido ? '' : ' detail-item-not-included'}" role="cell">
                    <small>${incluidoNoPedido ? 'No pedido' : 'Situação'}</small>
                    ${escapeHTML(quantidadePedida)}${incluidoNoPedido && item.unidade ? ` ${escapeHTML(item.unidade)}` : ''}
                    <span class="detail-item-state">${incluidoNoPedido ? 'Incluído no pedido' : `Continua na ${escapeHTML(itemObj.sc_ref || 'solicitação')}`}</span>
                </span>
            </div>`;
            }).join('')}
        </div>
    </section>`;
    let bodyHtml = tipo === 'SC'
        ? `<div class="space-y-3">
            ${tabelaItensSC}
            <div class="space-y-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5">
                <div class="detail-row flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <span class="detail-label">Pedido SAP:</span>
                    <span class="detail-value text-sm capitalize text-slate-900">${escapeHTML(itemObj.numero_pedido_sap || 'Não informado')}</span>
                </div>
                <div class="detail-row flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <span class="detail-label">Solicitante:</span>
                    <span class="detail-value text-sm capitalize text-slate-900">${escapeHTML(itemObj.solicitante || itemObj.setor || 'Solicitante')}</span>
                </div>
                <div class="detail-row flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <span class="detail-label">Status Operacional:</span>
                    <span class="detail-value text-sm text-slate-900">${formatStatus(itemObj.status)}</span>
                </div>
            </div>
        </div>`
        : `<div class="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5">
            ${listaItensPedidoPO}
            <div class="detail-row flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <span class="detail-label">Fornecedor Selecionado:</span>
                <span class="detail-value text-sm capitalize text-slate-900">${escapeHTML(itemObj.fornecedor || 'Não informado')}</span>
            </div>
            <div class="detail-row flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <span class="detail-label">Valor Aprovado:</span>
                <span class="detail-value text-sm text-slate-900">${escapeHTML(itemObj.valor_total || 'R$ 0,00')}</span>
            </div>
            <div class="detail-row flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <span class="detail-label">Data Prevista de Entrega:</span>
                <span class="detail-value text-sm capitalize text-slate-900">${escapeHTML(itemObj.data_entrega || itemObj.data_prevista || 'Ainda não definida')}</span>
            </div>
            <div class="detail-row flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <span class="detail-label">Origem (SC):</span>
                <span class="detail-value text-sm capitalize text-slate-900">${escapeHTML(itemObj.sc_ref || 'Compra Direta')}</span>
            </div>
            <div class="detail-row flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <span class="detail-label">Status Operacional:</span>
                <span class="detail-value text-sm text-slate-900">${formatStatus(itemObj.status)}</span>
            </div>
        </div>`;

    if (tipo === 'SC' && itemObj.db_id) {
        try {
            const resCot = await fetch(`/api/v1/cotacoes/${itemObj.db_id}`);
            if (resCot.ok) {
                const cotacoesList = await resCot.json();
                if (cotacoesList.length > 0) {
                    bodyHtml += `<section class="detail-quotes">
                        <h3>📊 Cotações apresentadas</h3>
                        <div class="detail-quotes-list">`;
                    cotacoesList.forEach(c => {
                        bodyHtml += `<div class="detail-quote-row"><strong>${escapeHTML(c.fornecedor)}</strong><span>${escapeHTML(c.valor_total)}</span><small>Prazo: ${escapeHTML(c.prazo_entrega)}</small></div>`;
                    });
                    bodyHtml += `</div></section>`;
                }
            }
        } catch(e) {}
    }

    document.getElementById('detalhes-body').innerHTML = bodyHtml;
    renderEtiquetasModal(); carregarComentarios(); carregarAnexos(); carregarRastreabilidade(tipo, itemObj.db_id);

    let fHtml = '';
    if (podeEditarSC) {
        fHtml += `<button class="btn btn-outline modal-action-secondary" onclick="salvarQuantidadesSolicitacao(${itemObj.db_id})">Salvar quantidades</button>`;
    }
    if (tipo === 'SC' && itemObj.status === 'cancelado' && !isLeitura) {
        fHtml += `<button class="btn modal-action-primary" onclick="restaurarSolicitacaoParaCotacao(${itemObj.db_id})">Restaurar para cotação</button>`;
    }
    if (itemObj.status !== 'cancelado' && itemObj.status !== 'aprovado' && itemObj.status !== 'entregue' && !isLeitura) {
        fHtml += `<button class="btn btn-outline modal-action-secondary modal-action-danger" onclick="cancelarItem(${itemObj.db_id}, '${tipo}')">🚫 Cancelar Item</button>`;
    }
    if (tipo === 'SC' && itemObj.status === 'pendente' && !isLeitura) {
        fHtml += `<button class="btn modal-action-primary" onclick="iniciarCotacao('${escapeHTML(itemObj.id)}', ${itemObj.db_id})">📋 Iniciar Cotação</button>`;
    } else if (tipo === 'SC' && itemObj.status === 'cotacao' && !isLeitura) {
        fHtml += `<button class="btn modal-action-primary" onclick="abrirCotacoes('${escapeHTML(itemObj.id)}', ${itemObj.db_id})">✅ Aprovar Cotação (Gerar PO)</button>`;
    } else if (tipo === 'PO' && (itemObj.status === 'gerado' || itemObj.status === 'aprovado') && !isLeitura) {
        fHtml += `<button class="btn modal-action-primary" onclick="alterarStatusPedido(${itemObj.db_id}, 'transito')">🚚 Despachado (Em Trânsito)</button>`;
    } else if (tipo === 'PO' && itemObj.status === 'transito' && !isLeitura) {
        fHtml += `<button class="btn modal-action-primary" onclick="alterarStatusPedido(${itemObj.db_id}, 'entregue')">📦 Recebido (Concluir)</button>`;
    }
    document.getElementById('modal-footer-actions').innerHTML = fHtml || `<span style="font-size:0.8rem; color:var(--text-body); font-style:italic;">Nenhuma ação disponível</span>`;
    document.getElementById('modalDetalhesCartao').classList.add('active');
}

async function carregarRastreabilidade(tipo, id) {
    const container = document.getElementById('detalhes-rastreabilidade');
    if (!container) return;
    container.innerHTML = '<span class="text-xs text-slate-500">Carregando fluxo...</span>';
    try {
        const resposta = await fetch(`/api/v1/rastreabilidade/${tipo}/${id}`);
        const dados = await resposta.json();
        if (!resposta.ok) throw new Error(dados.erro || 'Falha ao carregar rastreabilidade');
        container.innerHTML = dados.eventos.length ? `
            <div class="space-y-3">
                ${dados.eventos.map((evento, indice) => {
                    const data = evento.data ? new Date(evento.data).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
                    const referencia = evento.tipo === 'SC' || evento.tipo === 'PO'
                        ? `<button type="button" class="rastreabilidade-reference" onclick="abrirDetalhesCartao('${evento.tipo === 'SC' ? `SC-${1000 + evento.id}` : `PO-${500 + evento.id}`}', '${evento.tipo}')">${escapeHTML(evento.titulo)}</button>`
                        : `<strong class="block text-sm font-semibold text-slate-800">${escapeHTML(evento.titulo)}</strong>`;
                    const detalheTexto = `${evento.detalhe || ''}${evento.status ? ` | ${evento.status}` : ''}`;
                    return `
                        <article class="rastreabilidade-item">
                            <span class="rastreabilidade-marker" aria-hidden="true">${indice + 1}</span>
                            <div class="rastreabilidade-card">
                                <div class="rastreabilidade-header">
                                    <span>${escapeHTML(evento.etapa)}</span>
                                    ${data ? `<time class="whitespace-nowrap text-slate-400">${escapeHTML(data)}</time>` : ''}
                                </div>
                                ${referencia}
                                <p class="rastreabilidade-body line-clamp-3" aria-label="Detalhe do evento">${escapeHTML(detalheTexto)}</p>
                                <button type="button" class="rastreabilidade-toggle" data-expanded="false" aria-expanded="false" onclick="toggleRastreabilidadeDetalhe(this)">Ler mais</button>
                                <div class="rastreabilidade-usuario">Registrado por: ${escapeHTML(evento.usuario || 'Usuário não identificado')}</div>
                            </div>
                        </article>
                    `;
                }).join('')}
            </div>
        ` : '<span class="text-xs text-slate-500">Nenhum evento registrado.</span>';
    } catch (erro) {
        console.error(erro);
        container.innerHTML = '<span class="text-xs text-red-500">Não foi possível carregar a rastreabilidade.</span>';
    }
}

function toggleRastreabilidadeDetalhe(botao) {
    const bloco = botao.previousElementSibling;
    if (!bloco) return;
    const shouldExpand = botao.dataset.expanded !== 'true';
    botao.dataset.expanded = String(shouldExpand);
    botao.setAttribute('aria-expanded', String(shouldExpand));
    bloco.classList.toggle('line-clamp-3', !shouldExpand);
    botao.textContent = shouldExpand ? 'Ocultar' : 'Ler mais';
}

async function alterarStatusSC(id, status) { try{ await fetch(`/api/v1/solicitacoes/${id}/status`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({status}) }); closeModalDetalhes(); carregarSolicitacoes(true); }catch(e){} }
async function restaurarSolicitacaoParaCotacao(id) {
    if (!await confirmarAcao('Deseja restaurar esta solicitação para o status Em cotação?')) return;
    try {
        const resposta = await fetch(`/api/v1/solicitacoes/${id}/status`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ status: 'cotacao' }) });
        const resultado = await resposta.json();
        if (!resposta.ok) { alert(resultado.erro || 'Não foi possível restaurar a solicitação.'); return; }
        closeModalDetalhes();
        await carregarSolicitacoes(true);
        mostrarAviso('Solicitação restaurada para cotação.', 'success');
    } catch (erro) { console.error(erro); alert('Não foi possível conectar ao servidor.'); }
}
async function salvarQuantidadesSolicitacao(id) {
    const itemObj = solicitacoes.find(item => item.db_id === id);
    if (!itemObj) return;
    const itensBase = itemObj.itens_detalhados?.length ? itemObj.itens_detalhados : String(itemObj.item || '').split(';').map(item => item.trim()).filter(Boolean).map(item => ({ item, quantidade: null }));
    const campos = [...document.querySelectorAll('.sc-quantidade-edicao')];
    const itens = itensBase.map((item, indice) => {
        const linha = document.querySelector(`[data-sc-item="${indice}"]`);
        const status = linha?.dataset.statusItem || item.status || 'pendente';
        const quantidade = campos[indice]?.value || item.quantidade || (status === 'nao_comprar' ? 1 : '');
        return { ...item, quantidade, status };
    });
    if (itens.some(item => item.status !== 'nao_comprar' && (!item.quantidade || Number(item.quantidade) <= 0))) { alert('Informe uma quantidade válida para cada item.'); return; }
    try {
        const resposta = await fetch(`/api/v1/solicitacoes/${id}`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ itens }) });
        const resultado = await resposta.json();
        if (!resposta.ok) { alert(resultado.erro || 'Não foi possível salvar as quantidades.'); return; }
        closeModalDetalhes();
        await carregarSolicitacoes(true);
        mostrarAviso('Quantidades atualizadas com sucesso.', 'success');
    } catch (erro) { console.error(erro); alert('Não foi possível conectar ao servidor.'); }
}
function alternarStatusCompraSC(indice) {
    const linha = document.querySelector(`[data-sc-item="${indice}"]`);
    if (!linha) return;
    const naoComprar = linha.dataset.statusItem !== 'nao_comprar';
    linha.dataset.statusItem = naoComprar ? 'nao_comprar' : 'pendente';
    const descricao = linha.querySelector('.sc-item-descricao');
    const quantidade = linha.querySelector('.sc-quantidade-edicao');
    const status = linha.querySelector('.sc-status-label');
    const botao = linha.querySelector('.sc-toggle-nao-comprar');
    if (descricao) descricao.style.textDecoration = naoComprar ? 'line-through' : '';
    if (quantidade) { quantidade.disabled = naoComprar; quantidade.required = !naoComprar && Boolean(quantidade.value); }
    if (status) {
        status.textContent = naoComprar ? 'Não comprar' : 'Pendente';
        status.classList.toggle('nao-comprar', naoComprar);
        status.classList.toggle('pendente', !naoComprar);
    }
    if (botao) {
        botao.innerHTML = '<span aria-hidden="true">' + (naoComprar ? '↶' : '⊘') + '</span>';
        botao.title = naoComprar ? 'Reativar para compra' : 'Marcar como não comprar';
        botao.setAttribute('aria-pressed', String(naoComprar));
        botao.setAttribute('aria-label', naoComprar ? 'Reativar item para compra' : 'Marcar item como não comprar');
    }
}
async function alterarStatusPedido(id, status) { try{ const res = await fetch(`/api/v1/pedidos/${id}/status`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({status}) }); if (res.ok) { closeModalDetalhes(); await carregarPedidos(true); await carregarKPIs(); } }catch(e){ console.error(e); } }
async function cancelarItem(id, tipo) { if(await confirmarAcao("Deseja realmente cancelar este item? Ação não pode ser desfeita.")) { const url = tipo === 'SC' ? `/api/v1/solicitacoes/${id}/status` : `/api/v1/pedidos/${id}/status`; try{ await fetch(url, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({status: 'cancelado'}) }); closeModalDetalhes(); if(tipo==='SC') carregarSolicitacoes(true); else carregarPedidos(true); }catch(e){} } }
async function iniciarCotacao(scId, scDbId) {
    try {
        const res = await fetch(`/api/v1/solicitacoes/${scDbId}/status`, {
            method: 'PUT',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({status: 'cotacao'})
        });
        if (!res.ok) return;
        currentScDbId = scDbId;
        document.getElementById('cotacao-sc-id').innerText = escapeHTML(scId);
        closeModalDetalhes();
        await carregarSolicitacoes(true);
        openModalCotacao();
    } catch(e) { console.error(e); }
}

function renderEtiquetasModal() {
    const container = document.getElementById('detalhes-etiquetas');
    if(currentDetalhes.etiquetas.length === 0) { container.innerHTML = `<span style="font-size:0.75rem; color:var(--text-body); font-style:italic;">Sem etiquetas.</span>`; return; }
    container.innerHTML = currentDetalhes.etiquetas.map((tag, idx) => `<span style="font-size:0.7rem; padding: 4px 8px; background: var(--primary-color); color: white; border-radius: 4px; display: flex; align-items: center; gap: 6px;">${escapeHTML(tag)} <span style="cursor:pointer; font-weight:bold; opacity:0.8;" onclick="removerEtiqueta(${idx})">&times;</span></span>`).join('');
}
async function adicionarEtiqueta() {
    if (currentDetalhes.etiquetas.includes('emergencia')) return;
    currentDetalhes.etiquetas = ['emergencia']; await salvarEtiquetas();
}
async function removerEtiqueta(idx) { currentDetalhes.etiquetas.splice(idx, 1); await salvarEtiquetas(); }
async function salvarEtiquetas() { renderEtiquetasModal(); try { const res = await fetch(`/api/v1/etiquetas/${currentDetalhes.tipo}/${currentDetalhes.db_id}`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ etiquetas: currentDetalhes.etiquetas.join(',') }) });
        if (res.ok) { if(currentDetalhes.tipo === 'SC') await carregarSolicitacoes(true); else await carregarPedidos(true); await carregarKPIs(); }
    } catch(e) { console.error(e); } }

async function carregarComentarios() {
    const container = document.getElementById('lista-comentarios'); container.innerHTML = '<span style="font-size:0.8rem; color:var(--text-body);">Carregando histórico...</span>';
    try {
        const res = await fetch(`/api/v1/comentarios/${currentDetalhes.tipo}/${currentDetalhes.db_id}`);
        if(res.ok) {
            const lista = await res.json();
            container.innerHTML = lista.length === 0 ? '<span style="font-size:0.8rem; color:var(--text-body); font-style:italic;">Nenhum histórico registrado.</span>' : lista.map(c => `<div style="font-size:0.8rem; padding:8px; background:var(--bg-color); border-bottom:1px solid var(--border-color); border-radius:4px;"><strong style="color:var(--text-title); display:block; margin-bottom:2px;">🕒 ${escapeHTML(c.data)}</strong> ${escapeHTML(c.texto)}</div>`).join('');
        }
    } catch(e) {}
}
async function adicionarComentario() {
    const input = document.getElementById('novo-comentario'); 
    const txt = input ? input.value.trim() : '';
    if (!txt) return;

    if (!currentDetalhes || !currentDetalhes.tipo || !currentDetalhes.db_id) {
        alert("Erro: Nenhum cartão/pedido selecionado para comentar.");
        return;
    }

    try {
        const res = await fetch('/api/v1/comentarios', { 
            method: 'POST', 
            headers: {'Content-Type': 'application/json'}, 
            body: JSON.stringify({ 
                tipo: currentDetalhes.tipo, 
                ref_id: currentDetalhes.db_id, 
                texto: txt 
            }) 
        });
        
        const resposta = await res.json().catch(() => ({}));
        if (!res.ok) { 
            alert(resposta.erro || 'Não foi possível salvar o comentário.'); 
            return; 
        }
        
        input.value = '';
        carregarComentarios();
        
        if (currentDetalhes.tipo === 'PO' && /^\s*\/previs(?:ão|ao)\b/i.test(txt)) {
            carregarPedidos(true);
        }
        if (currentDetalhes.tipo === 'SC' && /^\s*\/(?:add|remove|receber)\b/i.test(txt)) {
            await carregarSolicitacoes(true);
            await abrirDetalhesCartao(currentDetalhes.id, 'SC');
        }
    } catch(e) { 
        console.error(e);
        alert('Não foi possível conectar ao servidor para salvar o comentário.'); 
    }
}
async function carregarAnexos() {
    const container = document.getElementById('lista-anexos'); container.innerHTML = '<span style="font-size:0.8rem; color:var(--text-body);">Procurando arquivos...</span>';
    try {
        const res = await fetch(`/api/v1/anexos/${currentDetalhes.tipo}/${currentDetalhes.db_id}`);
        if(res.ok) {
            const lista = await res.json();
            container.innerHTML = lista.length === 0 ? '<span style="font-size:0.8rem; color:var(--text-body); font-style:italic;">Nenhum arquivo anexado.</span>' : lista.map(a => `<div style="display:flex; justify-content:space-between; align-items:center; font-size:0.8rem; padding:8px; background:var(--bg-color); border:1px solid var(--border-color); border-radius:4px;"><span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width:150px;" title="${escapeHTML(a.nome_arquivo)}">📎 ${escapeHTML(a.nome_arquivo)}</span> <a href="${a.url}" target="_blank" class="btn btn-outline" style="padding:4px 8px; font-size:0.7rem; text-decoration:none;">Download</a></div>`).join('');
        }
    } catch(e) {}
}
async function addAnexoModal() {
    const fileInput = document.getElementById('novo-anexo-file'); if(!fileInput.files.length) { alert("Por favor, selecione um arquivo primeiro."); return; }
    const formData = new FormData(); formData.append('file', fileInput.files[0]); formData.append('tipo', currentDetalhes.tipo); formData.append('ref_id', currentDetalhes.db_id);
    try { const res = await fetch('/api/v1/anexos', { method: 'POST', body: formData }); if(res.ok) { fileInput.value = ''; carregarAnexos(); carregarComentarios(); } else { alert("Erro ao fazer upload do arquivo."); } } catch(e) {}
}


// === PREVISÃO / CALENDÁRIO ===
function setFiltroPrevisao(filtro, btnElement) { filtroPrevisaoAtual = filtro; document.querySelectorAll('.btn-pill-previsao').forEach(b => b.classList.remove('active')); if (btnElement) btnElement.classList.add('active'); renderDashboardPrevisao(); }

function renderDashboardPrevisao() { 
    const container = document.getElementById('dashboard-previsao-list'); 
    if (!container) return;
    
    const hoje = new Date(); hoje.setHours(0,0,0,0); 
    const diaSemana = hoje.getDay(); const inicioSemana = new Date(hoje); inicioSemana.setDate(hoje.getDate() - diaSemana); 
    const fimSemana = new Date(inicioSemana); fimSemana.setDate(inicioSemana.getDate() + 6); fimSemana.setHours(23,59,59,999); 
    const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1); const fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 23, 59, 59, 999); 

    const ativos = pedidos.filter(p => p.status === 'gerado' || p.status === 'aprovado' || p.status === 'transito');
    const filtrados = ativos.filter(p => { 
        let dataStr = p.data_entrega || p.data_prevista || p.data_prevista_iso;
        if (!dataStr) return false;
        let dataPrev;
        if (dataStr.includes('-')) { const [y, m, d] = dataStr.split('-').map(Number); dataPrev = new Date(y, m - 1, d); } 
        else if (dataStr.includes('/')) { const [d, m, y] = dataStr.split('/').map(Number); dataPrev = new Date(y, m - 1, d); } 
        else { return false; }
        dataPrev.setHours(0,0,0,0); 

        if (filtroPrevisaoAtual === 'hoje') return dataPrev.getTime() === hoje.getTime(); 
        else if (filtroPrevisaoAtual === 'semana') return dataPrev >= inicioSemana && dataPrev <= fimSemana; 
        else if (filtroPrevisaoAtual === 'mes') return dataPrev >= inicioMes && dataPrev <= fimMes; 
        return true; 
    }); 

    if (filtrados.length === 0) {
        let labelFiltro = filtroPrevisaoAtual === 'hoje' ? 'para hoje' : (filtroPrevisaoAtual === 'semana' ? 'para esta semana' : 'para este mês');
        container.innerHTML = `<span style="font-size:0.85rem; color:var(--text-body); font-style: italic;">Nenhuma entrega prevista ${labelFiltro}.</span>`;
        return;
    }
    
    container.innerHTML = filtrados.map(p => { 
        let badgeColor = p.atrasado ? '#fca5a5' : '#7dd3fc'; let badgeBg = p.atrasado ? 'rgba(239, 68, 68, 0.2)' : 'rgba(56, 189, 248, 0.15)'; 
        let statusLabel = p.atrasado ? 'Atrasado' : (p.status === 'transito' ? 'Em Trânsito' : 'Gerado'); 
        let dataExibicao = p.data_entrega || p.data_prevista;
        
        return `<div style="padding: 8px 10px; border: 1px solid var(--border-color); border-radius: 6px; background-color: var(--bg-color); border-left: 4px solid ${badgeColor}; box-shadow: 0 1px 2px rgba(0,0,0,0.1); margin-bottom:6px; cursor:pointer;" onclick="abrirDetalhesCartao('${escapeHTML(p.id)}', 'PO')">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <strong style="font-size: 0.8rem; color: var(--text-title); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 65%;">${escapeHTML(p.id)} - ${escapeHTML(p.item)}</strong>
                <span style="font-size: 0.6rem; font-weight: bold; color: ${badgeColor}; background-color: ${badgeBg}; padding: 2px 6px; border-radius: 4px; text-transform: uppercase;">${statusLabel}</span>
            </div>
            <div style="font-size: 0.7rem; color: var(--text-body); display: flex; justify-content: space-between; align-items: center;">
                <span>🏭 ${escapeHTML(p.fornecedor)}</span>
                <span style="font-weight: 600; color: var(--primary-color);">📅 ${escapeHTML(dataExibicao)}</span>
            </div>
        </div>`; 
    }).join(''); 
}

function abrirCalendarioGeral() { dataCalendarioAtual = new Date(); renderizarCalendario('calendario-grid', 'calendario-mes-ano'); document.getElementById('modalCalendarioGeral').classList.add('active'); }
function fecharCalendarioGeral() { document.getElementById('modalCalendarioGeral').classList.remove('active'); }

function mudarMesCalendario(delta) { 
    dataCalendarioAtual.setMonth(dataCalendarioAtual.getMonth() + delta); 
    if (currentUser && currentUser.perfil === 'estoque') {
        renderizarCalendario('calendario-inline-grid', 'calendario-inline-mes-ano');
    } else {
        renderizarCalendario('calendario-grid', 'calendario-mes-ano');
    }
}

function renderizarCalendario(gridId = 'calendario-grid', lblId = 'calendario-mes-ano') {
    const grid = document.getElementById(gridId);
    const lblMesAno = document.getElementById(lblId);
    if (!grid || !lblMesAno) return;

    const ano = dataCalendarioAtual.getFullYear(); const mes = dataCalendarioAtual.getMonth();
    const nomesMeses = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
    lblMesAno.innerText = `${nomesMeses[mes]} ${ano}`;

    grid.innerHTML = '';
    const primeiroDiaSemana = new Date(ano, mes, 1).getDay(); 
    const ultimoDiaMes = new Date(ano, mes + 1, 0).getDate(); 
    const entregas = pedidos.filter(p => p.status === 'gerado' || p.status === 'aprovado' || p.status === 'transito');

    for (let i = 0; i < primeiroDiaSemana; i++) { grid.innerHTML += `<div style="background-color: var(--bg-color); opacity: 0.3; border-radius: 6px; border: 1px solid var(--border-color);"></div>`; }

    for (let dia = 1; dia <= ultimoDiaMes; dia++) {
        const dataDiaAtual = new Date(ano, mes, dia); dataDiaAtual.setHours(0,0,0,0);

        const entregasDoDia = entregas.filter(p => {
            let dataStr = p.data_entrega || p.data_prevista || p.data_prevista_iso;
            if (!dataStr) return false;
            let dataPrev;
            if (dataStr.includes('-')) { const [y, m, d] = dataStr.split('-').map(Number); dataPrev = new Date(y, m - 1, d); } 
            else if (dataStr.includes('/')) { const [d, m, y] = dataStr.split('/').map(Number); dataPrev = new Date(y, m - 1, d); } 
            else { return false; }
            dataPrev.setHours(0,0,0,0);
            return dataPrev.getTime() === dataDiaAtual.getTime();
        });

        let badgesHtml = '';
        if (entregasDoDia.length > 0) {
            entregasDoDia.forEach(ent => {
                let badgeColor = ent.atrasado ? 'var(--danger-color)' : 'var(--primary-color)';
                let bgBadge = ent.atrasado ? 'rgba(239, 68, 68, 0.15)' : 'rgba(59, 130, 246, 0.15)';
                badgesHtml += `<div style="font-size: 0.65rem; color: ${badgeColor}; background: ${bgBadge}; margin-top: 4px; padding: 2px 4px; border-radius: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none;" title="${escapeHTML(ent.id)} - ${escapeHTML(ent.fornecedor)}">
                    ${escapeHTML(ent.id)}
                </div>`;
            });
        }

        const hoje = new Date(); hoje.setHours(0,0,0,0);
        const isHoje = dataDiaAtual.getTime() === hoje.getTime();
        const borderStyle = isHoje ? 'border: 2px solid var(--primary-color);' : 'border: 1px solid var(--border-color);';
        const numStyle = isHoje ? 'background: var(--primary-color); color: white; border-radius: 50%; width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center;' : 'color: var(--text-title);';
        const interacao = `cursor: pointer; transition: 0.2s;`;

        grid.innerHTML += `
            <div onclick="abrirListaDia(${ano}, ${mes}, ${dia})" style="background-color: var(--bg-color); padding: 4px; border-radius: 6px; ${borderStyle} ${interacao} display: flex; flex-direction: column; overflow: hidden;" onmouseover="this.style.filter='brightness(0.95)'" onmouseout="this.style.filter='none'">
                <div style="font-size: 0.85rem; font-weight: bold; text-align: right; margin-bottom: 4px; pointer-events: none;"><span style="${numStyle}">${dia}</span></div>
                <div style="display: flex; flex-direction: column; gap: 2px; flex: 1; overflow-y: auto; pointer-events: none;">
                    ${badgesHtml}
                </div>
            </div>
        `;
    }
}

// === LISTA DE ENTREGAS DO DIA ===
function abrirListaDia(ano, mes, dia) {
    const dataClique = new Date(ano, mes, dia); dataClique.setHours(0,0,0,0);
    const entregas = pedidos.filter(p => p.status === 'gerado' || p.status === 'aprovado' || p.status === 'transito');
    
    const entregasDoDia = entregas.filter(p => {
        let dataStr = p.data_entrega || p.data_prevista || p.data_prevista_iso;
        if (!dataStr) return false;
        let dataPrev;
        if (dataStr.includes('-')) { const [y, m, d] = dataStr.split('-').map(Number); dataPrev = new Date(y, m - 1, d); } 
        else if (dataStr.includes('/')) { const [d, m, y] = dataStr.split('/').map(Number); dataPrev = new Date(y, m - 1, d); } 
        else { return false; }
        dataPrev.setHours(0,0,0,0);
        return dataPrev.getTime() === dataClique.getTime();
    });

    const titulo = document.getElementById('titulo-lista-dia');
    const conteudo = document.getElementById('conteudo-lista-dia');
    
    titulo.innerText = `Entregas - ${String(dia).padStart(2, '0')}/${String(mes+1).padStart(2, '0')}/${ano}`;
    
    if (entregasDoDia.length === 0) {
        conteudo.innerHTML = `<span style="font-size:0.85rem; color:var(--text-body); font-style: italic;">Nenhuma entrega para este dia.</span>`;
    } else {
        conteudo.innerHTML = entregasDoDia.map(p => { 
            let badgeColor = p.atrasado ? '#fca5a5' : '#7dd3fc'; 
            let badgeBg = p.atrasado ? 'rgba(239, 68, 68, 0.15)' : 'rgba(56, 189, 248, 0.15)'; 
            let statusLabel = p.atrasado ? 'Atrasado' : (p.status === 'transito' ? 'Em Trânsito' : 'Gerado'); 
            
            const isEstoque = document.body.classList.contains('modo-estoque') || (currentUser && currentUser.perfil === 'estoque');
            const statusPodeReceber = ['gerado', 'aprovado', 'transito'].includes(p.status);
            const mostraReceber = isEstoque && statusPodeReceber && p.status !== 'entregue' && p.status !== 'cancelado';
            
            return `<div style="border: 1px solid var(--border-color); border-radius: 6px; background-color: var(--bg-color); box-shadow: 0 1px 2px rgba(0,0,0,0.1); margin-bottom:6px;">
                <div style="padding: 8px 10px; border-left: 4px solid ${badgeColor}; cursor:pointer;" onclick="fecharListaDia(); fecharCalendarioGeral(); abrirDetalhesCartao('${escapeHTML(p.id)}', 'PO')">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        <strong style="font-size: 0.8rem; color: var(--text-title); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 65%;">${escapeHTML(p.id)} - ${escapeHTML(p.item)}</strong>
                        <span style="font-size: 0.6rem; font-weight: bold; color: ${badgeColor}; background-color: ${badgeBg}; padding: 2px 6px; border-radius: 4px; text-transform: uppercase;">${statusLabel}</span>
                    </div>
                    <div style="font-size: 0.7rem; color: var(--text-body); display: flex; justify-content: space-between; align-items: center;">
                        <span>🚚 ${escapeHTML(p.fornecedor)}</span>
                        <span style="font-weight: 600; color: var(--primary-color);">Valor: ${escapeHTML(p.valor_total)}</span>
                    </div>
                </div>
                ${mostraReceber ? `<div style="padding: 0 8px 8px 8px;"><button class="btn" type="button" style="padding:6px 12px; font-size:0.75rem; background-color:var(--success-color); width:100%; border:none; cursor:pointer; color:white; font-weight:600; border-radius:4px;" onclick="receberEntrega(${p.db_id ?? p.id})">📦 Receber Entrega</button></div>` : ''}
            </div>`; 
        }).join(''); 
    }
    document.getElementById('modalListaDia').classList.add('active');
}
function fecharListaDia() { document.getElementById('modalListaDia').classList.remove('active'); }
function abrirDetalhesRotaConsulta(id) {
    const rota = rotasData.find(item => item.id === Number(id));
    if (!rota) { alert('Não foi possível localizar esta rota. Atualize os dados e tente novamente.'); return; }
    document.getElementById('rota-consulta-titulo').textContent = `Rota: ${rota.destino_fornecedor}`;
    document.getElementById('rota-consulta-conteudo').innerHTML = `<div><strong>Data:</strong> ${escapeHTML(formatarDataRota(rota.data_prevista))}</div><div><strong>Motorista:</strong> ${escapeHTML(rota.motorista)}</div><div><strong>Destino:</strong> ${escapeHTML(rota.destino_fornecedor)}</div><div><strong>Endereço:</strong> ${escapeHTML(rota.endereco || 'Não informado')}</div><div><strong>Referência:</strong> ${escapeHTML(rota.po_ref || 'Não informada')}</div><div><strong>Status:</strong> ${escapeHTML(rota.status)}</div><div><strong>Observações:</strong> ${escapeHTML(rota.observacoes || 'Nenhuma')}</div>`;
    const botaoMapa = document.getElementById('rota-consulta-mapa');
    botaoMapa.style.display = rota.localizacao_mapa ? 'inline-flex' : 'none';
    botaoMapa.onclick = () => abrirMapaRota(rota.id);
    document.getElementById('modalDetalhesRotaConsulta').classList.add('active');
}
function fecharDetalhesRotaConsulta() { document.getElementById('modalDetalhesRotaConsulta').classList.remove('active'); }

// === RENDERIZAÇÃO DAS TABELAS ===
function dinheiroMRP(valor) { return valor == null ? '-' : Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function percentualMRP(valor) { return valor == null ? '-' : `${Number(valor).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`; }
function dataMRP(valor) { if (!valor) return '-'; const data = String(valor).slice(0, 10).split('-'); return data.length === 3 && data[0].length === 4 ? `${data[2]}/${data[1]}/${data[0]}` : valor; }
function dataExcelMRP(valor) {
    if (typeof valor === 'number' && Number.isFinite(valor)) {
        const data = new Date(Date.UTC(1899, 11, 30) + valor * 86400000);
        return `${String(data.getUTCDate()).padStart(2, '0')}/${String(data.getUTCMonth() + 1).padStart(2, '0')}/${data.getUTCFullYear()}`;
    }
    return dataMRP(valor);
}
function numeroMRP(valor) { return Number.isFinite(Number(valor)) ? Number(valor) : 0; }
function quantidadeMRP(valor) { return numeroMRP(valor).toLocaleString('pt-BR', { maximumFractionDigits: 2 }); }
function textoCelulaPlanilha(valor) { const texto = valor == null ? '' : String(valor); return /^\d{4}-\d{2}-\d{2}T/.test(texto) ? dataMRP(texto) : texto; }
function colunaPlanilha(indice) { let nome = ''; let numero = indice + 1; while (numero > 0) { const resto = (numero - 1) % 26; nome = String.fromCharCode(65 + resto) + nome; numero = Math.floor((numero - 1) / 26); } return nome; }
function renderPlanilhaMRP(materiais) {
    const container = document.getElementById('mrp-planilha-result');
    if (!container) return;
    const planilhas = materiais.map(material => material.planilha).filter(planilha => planilha?.aba && planilha.linhas?.length);
    if (!planilhas.length) { container.hidden = true; container.innerHTML = ''; return; }
    const unicas = [...new Map(planilhas.map(planilha => [planilha.aba, planilha])).values()];
    container.innerHTML = `<div class="mrp-planilha-heading"><span class="preco-card-kicker">Dados originais</span><h2>Conteúdo completo da planilha</h2><p class="mrp-planilha-desktop-hint">Visualização em grade, semelhante ao Excel.</p><p class="mrp-planilha-mobile-hint">Abra uma linha para consultar todos os campos originais.</p></div>${unicas.map(planilha => { const colunas = Math.max(...planilha.linhas.map(linha => linha.length)); const cabecalho = Array.from({ length: colunas }, (_, indice) => `<th>${colunaPlanilha(indice)}<span class="coluna-planilha">${colunaPlanilha(indice)}</span></th>`).join(''); const tabela = planilha.linhas.map((linha, indice) => `<tr><th>${indice + 1}</th>${Array.from({ length: colunas }, (_, coluna) => `<td>${escapeHTML(textoCelulaPlanilha(linha[coluna]))}</td>`).join('')}</tr>`).join(''); const linhas = planilha.linhas.map((linha, indice) => { const campos = linha.map((valor, coluna) => valor == null || String(valor).trim() === '' ? '' : `<div class="mrp-planilha-cell"><span>${colunaPlanilha(coluna)}</span><strong>${escapeHTML(textoCelulaPlanilha(valor))}</strong></div>`).filter(Boolean); if (!campos.length) return ''; const resumo = campos.slice(0, 2).map(campo => campo.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).join(' | '); return `<details class="mrp-planilha-expander"><summary><span>Linha ${indice + 1}</span><strong>${escapeHTML(resumo.slice(0, 100))}</strong><small>${campos.length} ${campos.length === 1 ? 'campo' : 'campos'}</small></summary><div class="mrp-planilha-row-content">${campos.join('')}</div></details>`; }).join(''); return `<section class="mrp-planilha-sheet"><h3>Aba: ${escapeHTML(planilha.aba || '')}</h3><div class="mrp-planilha-scroll mrp-planilha-desktop"><table><thead><tr><th>#</th>${cabecalho}</tr></thead><tbody>${tabela}</tbody></table></div><div class="mrp-planilha-mobile">${linhas}</div></section>`; }).join('')}`;
    container.hidden = false;
}
function renderHistoricoMRP(material) {
    const resumo = material.resumo_historico || {};
    const historico = material.historico || [];
    if (!historico.length) return '<div class="mrp-history-empty">Sem histórico de preços importado para este material.</div>';
    const linhas = historico.slice(-5).reverse().map(registro => `<tr><td>${escapeHTML(dataMRP(registro.data_recebimento))}</td><td>${escapeHTML(registro.nfe || '-')}</td><td>${dinheiroMRP(registro.valor_fio_kg)}</td><td>${dinheiroMRP(registro.valor_servico_kg)}</td><td>${percentualMRP(registro.perda_percentual)}</td><td><strong>${dinheiroMRP(registro.preco_final_kg)}</strong></td></tr>`).join('');
    return `<div class="mrp-history-card"><div class="mrp-history-head"><div><span class="preco-card-kicker">Histórico importado</span><strong>${escapeHTML(String(resumo.registros || 0))} ${resumo.registros === 1 ? 'registro' : 'registros'}</strong></div><small>${escapeHTML((resumo.fontes || []).join(' / '))}</small></div><div class="mrp-history-metrics"><div><span>Último preço</span><strong>${dinheiroMRP(resumo.ultimo_preco_kg)}</strong><small>por kg</small></div><div><span>Média do preço</span><strong>${dinheiroMRP(resumo.media_preco_kg)}</strong><small>por kg</small></div><div><span>Média do fio</span><strong>${dinheiroMRP(resumo.media_fio_kg)}</strong><small>por kg</small></div></div><div class="mrp-history-table"><table><thead><tr><th>Data</th><th>NFE</th><th>Fio</th><th>Serviço</th><th>Perda</th><th>Preço final</th></tr></thead><tbody>${linhas}</tbody></table></div></div>`;
}
function dadosHistoricoVarianteMRP(material) {
    const linhas = material.planilha?.linhas || [];
    const estampado = /estampad/i.test(material.nome);
    const coluna = estampado ? { planejado: 5, comprado: 8, recebido: 9 } : { planejado: 12, comprado: 15, recebido: 16 };
    const pedidos = [];
    let compradoTotal = 0;
    let recebidoTotal = 0;
    linhas.slice(13).forEach(linha => {
        const identificador = String(linha[0] ?? '').trim();
        const comprado = numeroMRP(linha[coluna.comprado]);
        const recebido = numeroMRP(linha[coluna.recebido]);
        if (identificador.toUpperCase() === 'COMPRA') {
            compradoTotal += comprado;
            recebidoTotal += recebido;
            return;
        }
        if (!identificador || !/^\d/.test(identificador)) return;
        const planejado = numeroMRP(linha[coluna.planejado]);
        const estoqueMaterial = materiaisMRP.find(item => item.nome.toLowerCase() === String(linha[1] || '').toLowerCase())?.estoque_atual;
        pedidos.push({
            numero: identificador,
            modelo: linha[1] || '-',
            data: dataExcelMRP(linha[2]),
            pecas: numeroMRP(linha[3]),
            planejado,
            comprado,
            recebido,
            saldoFornecedor: comprado - recebido,
            estoque: estoqueMaterial
        });
    });
    const planejadoImportado = numeroMRP(material.demanda_pecas) * numeroMRP(material.consumo_por_peca);
    const compradoImportado = numeroMRP(material.comprado_recebido);
    return {
        pedidos,
        compradoTotal: material.planilha ? compradoImportado : compradoTotal,
        recebidoTotal: material.planilha ? compradoImportado : recebidoTotal,
        planejadoTotal: material.planilha ? planejadoImportado : pedidos.reduce((total, pedido) => total + pedido.planejado, 0)
    };
}
function renderResumoMaterialMRP(material, historico) {
    const compras = material.compras || [];
    const pedidosMRP = material.pedidos_mrp || [];
    const planejadoPedidos = pedidosMRP.reduce((total, pedido) => total + numeroMRP(pedido.consumo_total), 0);
    const compradoNovo = compras.reduce((total, compra) => total + numeroMRP(compra.quantidade), 0);
    const recebidoNovo = compras.reduce((total, compra) => total + numeroMRP(compra.quantidade_recebida), 0);
    const planejadoTotal = historico.planejadoTotal + planejadoPedidos;
    const saldo = numeroMRP(material.estoque_atual) + historico.compradoTotal + compradoNovo - planejadoTotal;
    const incluirModelo = Boolean(material.eh_demillus || /demillus/i.test(material.nome));
    const colunaModelo = incluirModelo ? '<th>Modelo</th>' : '';
    const celulaModelo = pedido => incluirModelo ? `<td>${escapeHTML(pedido.modelo)}</td>` : '';
    const pedidosPlanilhaHtml = historico.pedidos.map(pedido => `<tr><td>${escapeHTML(pedido.numero)}</td>${celulaModelo(pedido)}<td>${escapeHTML(pedido.data)}</td><td>${quantidadeMRP(pedido.pecas)}</td><td>${quantidadeMRP(pedido.pecas * numeroMRP(material.consumo_por_peca))}</td><td>${quantidadeMRP(pedido.comprado)}</td><td>${quantidadeMRP(pedido.recebido)}</td><td>${quantidadeMRP(pedido.saldoFornecedor)}</td></tr>`).join('');
    const pedidosMRPHtmL = pedidosMRP.map(pedido => `<tr><td>Pedido #${pedido.id}</td>${celulaModelo({modelo: pedido.cliente})}<td>${escapeHTML(pedido.data_pedido)}</td><td>${quantidadeMRP(pedido.quantidade_pecas)}</td><td>${quantidadeMRP(pedido.consumo_total)}</td><td>0</td><td>0</td><td>0</td><td>-</td></tr>`).join('');
    const pedidosCompraHtml = compras.map(compra => `<tr><td>Compra #${compra.id}</td>${celulaModelo({modelo: '-'})}<td>${escapeHTML(dataMRP(compra.data_compra))}</td><td>-</td><td>-</td><td>${quantidadeMRP(compra.quantidade)}</td><td>${quantidadeMRP(compra.quantidade_recebida)}</td><td>${quantidadeMRP(compra.saldo_fornecedor)} ${compra.saldo_fornecedor > 0 ? `<button class="btn btn-outline" style="padding:3px 7px; font-size:.7rem; margin-left:5px;" onclick="abrirRecebimentoMRP(${material.id}, ${compra.id})">Receber compra</button>` : ''}</td><td><button class="btn btn-outline" style="padding:3px 7px; font-size:.7rem;" onclick="editarCompraMRP(${material.id}, ${compra.id})">Editar</button> <button class="btn btn-outline" style="padding:3px 7px; font-size:.7rem; color:var(--danger-color);" onclick="excluirCompraMRP(${material.id}, ${compra.id})">Excluir</button></td></tr>`).join('');
    const pedidosHtml = pedidosPlanilhaHtml + pedidosMRPHtmL + pedidosCompraHtml;
    const colunasVazias = incluirModelo ? 8 : 7;
    return `<div class="mrp-material-history"><div class="mrp-history-summary"><strong>Histórico de pedidos</strong><span>Planejado líquido: ${quantidadeMRP(planejadoTotal - historico.compradoTotal - compradoNovo)} | Comprado: ${quantidadeMRP(historico.compradoTotal + compradoNovo)} | Recebido: ${quantidadeMRP(historico.recebidoTotal + recebidoNovo)} | Saldo: ${quantidadeMRP(saldo)}</span></div><div class="mrp-history-note">Pedidos cadastrados: ${pedidosMRP.length} | Saldo com o fornecedor = quantidade comprada - quantidade recebida</div><div class="mrp-history-table"><table><thead><tr><th>Nº do pedido</th>${colunaModelo}<th>Data do pedido</th><th>Quantidade de peças</th><th>Planejado</th><th>Quantidade comprada</th><th>Quantidade recebida</th><th>Saldo com fornecedor</th><th>Ações</th></tr></thead><tbody>${pedidosHtml || `<tr><td colspan="${colunasVazias + 1}">Nenhum pedido identificado na aba.</td></tr>`}</tbody></table></div></div>`;
}
function renderConsumoDemillusMRP(material) {
    if (!material.eh_demillus) return '';
    const linhas = (material.planilha?.linhas || []).slice(1, 7).filter(linha => linha[12]);
    const tabela = linhas.map(linha => `<tr><td>${escapeHTML(linha[12])}</td><td>${quantidadeMRP(linha[15])}</td><td>${quantidadeMRP(linha[16])}</td></tr>`).join('');
    return `<div class="mrp-demillus-check"><label><input type="checkbox" checked disabled> Demillus</label><span>Consumo por item</span></div><div class="mrp-consumo-item"><table><thead><tr><th>Item</th><th>Estampado</th><th>Liso</th></tr></thead><tbody>${tabela || '<tr><td colspan="3">Consumo por item não informado na planilha.</td></tr>'}</tbody></table></div>`;
}
function renderHistoricoPlanilhaMRP(material) {
    const linhas = material.planilha?.linhas || [];
    if (!linhas.length) return '';
    const colunas = Math.max(...linhas.map(linha => linha.length));
    const cabecalho = Array.from({ length: colunas }, (_, indice) => `<th>${colunaPlanilha(indice)}<span class="coluna-planilha">${colunaPlanilha(indice)}</span></th>`).join('');
    const corpo = linhas.map((linha, indice) => `<tr><th>${indice + 1}</th>${Array.from({ length: colunas }, (_, coluna) => `<td>${escapeHTML(textoCelulaPlanilha(linha[coluna]))}</td>`).join('')}</tr>`).join('');
    return `<div class="mrp-planilha-sheet"><div class="mrp-history-summary"><strong>Histórico completo da planilha</strong><span>Aba: ${escapeHTML(material.planilha.aba || '-')} | ${linhas.length} linhas</span></div><div class="mrp-planilha-scroll"><table><thead><tr><th>#</th>${cabecalho}</tr></thead><tbody>${corpo}</tbody></table></div></div>`;
}
function abrirDetalhesMRP(id) {
    const material = materiaisMRP.find(item => item.id === id);
    if (!material) return;
    const historico = dadosHistoricoVarianteMRP(material);
    document.getElementById('detalhes-mrp-titulo').textContent = material.produto_nome || material.nome;
    document.getElementById('detalhes-mrp-corpo').innerHTML = `${renderConsumoDemillusMRP(material)}${renderResumoMaterialMRP(material, historico)}${renderHistoricoPlanilhaMRP(material)}`;
    document.getElementById('modalDetalhesMRP').classList.add('active');
}
function fecharDetalhesMRP() { document.getElementById('modalDetalhesMRP').classList.remove('active'); }
function saldoCalculadoraMaterial(material) {
    const historico = dadosHistoricoVarianteMRP(material);
    const planejado = historico.planejadoTotal + (material.pedidos_mrp || []).reduce((total, pedido) => total + numeroMRP(pedido.consumo_total), 0);
    const comprado = historico.compradoTotal + (material.compras || []).reduce((total, compra) => total + numeroMRP(compra.quantidade), 0);
    return comprado - planejado;
}
function atualizarCalculadoraNecessidade() {
    const materiais = [...document.querySelectorAll('.mrp-calculadora-item')];
    const negativos = materiais.filter(item => Number(item.dataset.saldo) < 0);
    const necessidade = negativos.reduce((total, item) => total + Math.abs(Number(item.dataset.saldo)), 0);
    const resultado = document.getElementById('mrp-calculadora-resultado');
    const quantidade = document.getElementById('mrp-calculadora-quantidade');
    if (resultado) resultado.textContent = `${materiais.length} material${materiais.length === 1 ? '' : 'is'} considerados`;
    if (quantidade) quantidade.textContent = quantidadeMRP(necessidade);
}
function removerMaterialCalculadora(id) {
    materiaisCalculadoraSelecionados.delete(Number(id));
    renderCalculadoraNecessidade();
}
function limparCalculadoraNecessidade() {
    materiaisCalculadoraSelecionados.clear();
    fecharCalculadoraNecessidade();
}
function fecharCalculadoraNecessidade() {
    const painel = document.getElementById('mrp-calculadora');
    materiaisCalculadoraSelecionados.clear();
    if (painel) painel.hidden = true;
}
function renderCalculadoraNecessidade() {
    const painel = document.getElementById('mrp-calculadora');
    if (!painel) return;
    const materiais = materiaisMRP.filter(material => !material.oculto && materiaisCalculadoraSelecionados.has(material.id));
    painel.innerHTML = `<div class="mrp-calculadora-cabecalho"><div><strong>Necessidade de compra</strong><small>Os materiais adicionados pelos ícones são somados automaticamente. Saldos negativos entram em módulo.</small></div><div class="mrp-calculadora-acoes"><button type="button" class="mrp-calculadora-limpar" onclick="limparCalculadoraNecessidade()">Limpar</button><button type="button" class="mrp-calculadora-fechar" onclick="fecharCalculadoraNecessidade()" aria-label="Fechar calculadora">&times;</button></div></div><div class="mrp-calculadora-lista">${materiais.map(material => { const saldo = saldoCalculadoraMaterial(material); return `<div class="mrp-calculadora-item" data-saldo="${saldo}"><span><strong>${escapeHTML(material.produto_nome || material.nome)}</strong><small>${escapeHTML(material.cliente || '')} | ${escapeHTML(material.material_utilizado || material.nome)}</small></span><b class="${saldo < 0 ? 'mrp-necessidade-negativa' : 'mrp-necessidade-positiva'}">${quantidadeMRP(saldo)}</b><button type="button" class="mrp-calculadora-remover" onclick="removerMaterialCalculadora(${material.id})" aria-label="Remover material do cálculo" title="Remover material do cálculo">&times;</button></div>`; }).join('') || '<span>Nenhum material adicionado.</span>'}</div><div class="mrp-calculadora-resultado"><span id="mrp-calculadora-resultado">0 materiais considerados</span><strong><small>Total para comprar</small><b id="mrp-calculadora-quantidade">0</b></strong></div>`;
    painel.hidden = false;
    atualizarCalculadoraNecessidade();
}
function abrirCalculadoraNecessidade(idsMateriais = []) {
    idsMateriais.forEach(id => materiaisCalculadoraSelecionados.add(Number(id)));
    renderCalculadoraNecessidade();
}
function filtrarMRP() { mrpRenderLimit = 15; renderMRP(); }
function renderMRP() {
    const tbody = document.getElementById('mrp-table-body');
    if (!tbody || (currentUser && (currentUser.perfil === 'solicitante' || currentUser.perfil === 'estoque'))) return;

    const resultados = document.getElementById('mrp-results');
    const termoBusca = (document.getElementById('search-mrp')?.value || "").trim().toLowerCase();
    if (resultados) resultados.hidden = termoBusca.length < 2;
    if (termoBusca.length < 2) {
        tbody.innerHTML = '';
        const planilha = document.getElementById('mrp-planilha-result');
        if (planilha) { planilha.hidden = true; planilha.innerHTML = ''; }
        return;
    }
    const filtrados = materiaisMRP.filter(m => !m.oculto && `${m.produto_nome || ''} ${m.cliente || ''} ${m.material_utilizado || m.nome}`.toLowerCase().includes(termoBusca));
    const grupos = new Map();
    filtrados.forEach(material => {
        const chave = `${String(material.cliente || '').trim().toLowerCase()}|${String(material.produto_nome || material.nome || '').trim().toLowerCase()}`;
        if (!grupos.has(chave)) grupos.set(chave, []);
        grupos.get(chave).push(material);
    });
    const lote = [...grupos.values()].slice(0, mrpRenderLimit);
    const planilha = document.getElementById('mrp-planilha-result');
    if (planilha) { planilha.hidden = true; planilha.innerHTML = ''; }

    let html = lote.map(grupo => {
        const primeiro = grupo[0];
        const cliente = primeiro.cliente ? `<small style="display:block; margin-top:4px; color:var(--text-body);">Cliente: ${escapeHTML(primeiro.cliente)}</small>` : '';
        const resumoProduto = grupo.reduce((resumo, material) => {
            const historico = dadosHistoricoVarianteMRP(material);
            const pedidos = material.pedidos_mrp || [];
            const compras = material.compras || [];
            resumo.planejado += historico.planejadoTotal + pedidos.reduce((total, pedido) => total + numeroMRP(pedido.consumo_total), 0);
            resumo.comprado += historico.compradoTotal + compras.reduce((total, compra) => total + numeroMRP(compra.quantidade), 0);
            return resumo;
        }, { planejado: 0, comprado: 0 });
        const necessidade = resumoProduto.comprado - resumoProduto.planejado;
        const materiaisHtml = grupo.map((m, indice) => {
            const historico = dadosHistoricoVarianteMRP(m);
            const compras = m.compras || [];
            const saldo = numeroMRP(m.estoque_atual) + historico.compradoTotal + compras.reduce((total, compra) => total + numeroMRP(compra.quantidade), 0) - historico.planejadoTotal;
            const planejadoMaterial = historico.planejadoTotal + (m.pedidos_mrp || []).reduce((total, pedido) => total + numeroMRP(pedido.consumo_total), 0);
            const compradoMaterial = historico.compradoTotal + compras.reduce((total, compra) => total + numeroMRP(compra.quantidade), 0);
            const saldoMaterial = compradoMaterial - planejadoMaterial;
            const nomeMaterial = escapeHTML(m.material_utilizado || m.nome);
            const nomeExcluir = escapeHTML(m.produto_nome || m.nome).replace(/'/g, "\\'");
            const menu = `<div class="mrp-actions-menu"><button type="button" class="btn btn-outline mrp-actions-trigger" onclick="event.preventDefault(); event.stopPropagation(); this.parentElement.classList.toggle('is-open')">⋮ Ações</button><div class="mrp-actions-list"><button type="button" onclick="abrirEditMRP(${m.id})">Editar</button><button type="button" onclick="abrirCompraMRP(${m.id})">Compra</button>${saldoMaterial < 0 ? `<button type="button" onclick="gerarSCdoMRP(${m.id})">+ SC (${escapeHTML(m.sugestao_compra)})</button>` : ''}<button type="button" class="mrp-action-danger" onclick="excluirProdutoMRP(${m.id}, '${nomeExcluir}')">Excluir</button><button type="button" onclick="ocultarMRP(${m.id})">Ocultar</button></div></div>`;
            const indicadores = grupo.length > 1 ? `<div class="mrp-kpi-grid mrp-material-summary"><div><span>Planejado</span><strong>${quantidadeMRP(planejadoMaterial)}</strong><small>unidades</small></div><div><span>Comprado</span><strong>${quantidadeMRP(compradoMaterial)}</strong><small>unidades</small></div><div><span>Saldo</span><strong class="${saldoMaterial < 0 ? 'mrp-necessidade-negativa' : 'mrp-necessidade-positiva'}">${quantidadeMRP(saldoMaterial)}</strong><small>comprado - planejado</small></div></div>` : '';
            const calculadoraMaterial = grupo.length > 1 ? `<button type="button" class="mrp-calculadora-trigger mrp-material-calc-trigger" onclick="event.preventDefault(); event.stopPropagation(); abrirCalculadoraNecessidade([${m.id}])" aria-label="Calcular necessidade deste material" title="Calcular necessidade deste material">🧮</button>` : '';
            return `<div class="mrp-material-button" role="group"><div class="mrp-material-head"><button type="button" class="mrp-material-open" onclick="event.preventDefault(); event.stopPropagation(); abrirDetalhesMRP(${m.id})"><span>Material ${indice + 1}</span><strong>${nomeMaterial}</strong><small>${escapeHTML(m.item_referencia ? `${m.item_referencia.codigo} - ${m.item_referencia.descricao}` : 'Abrir detalhes')}</small></button>${calculadoraMaterial}</div>${indicadores}${menu}</div>`;
        }).join('');
        const resumoGeral = grupo.length === 1 ? `<div class="mrp-kpi-grid mrp-product-summary"><div><span>Planejado</span><strong>${quantidadeMRP(resumoProduto.planejado)}</strong><small>unidades</small></div><div><span>Comprado</span><strong>${quantidadeMRP(resumoProduto.comprado)}</strong><small>unidades</small></div><div><span>Saldo</span><strong class="${necessidade < 0 ? 'mrp-necessidade-negativa' : 'mrp-necessidade-positiva'}">${quantidadeMRP(necessidade)}</strong><small>comprado - planejado</small></div></div>` : '';
        const calculadoraProduto = grupo.length === 1 ? `<button type="button" class="mrp-calculadora-trigger" onclick="event.preventDefault(); event.stopPropagation(); abrirCalculadoraNecessidade([${primeiro.id}])" aria-label="Calcular necessidade do material" title="Calcular necessidade do material">🧮</button>` : '';
        return `<details class="mrp-product-card"><summary><header class="mrp-product-head"><div><span class="preco-card-kicker">Produto selecionado</span><h2>${escapeHTML(primeiro.produto_nome || primeiro.nome)}</h2>${cliente}<small style="display:block; margin-top:8px; color:var(--text-body);">${grupo.length} material${grupo.length === 1 ? '' : 'is'} vinculado${grupo.length === 1 ? '' : 's'}</small></div><div class="mrp-product-actions" onclick="event.stopPropagation()">${calculadoraProduto}<button type="button" class="mrp-expand-button" onclick="event.preventDefault(); event.stopPropagation(); abrirDetalhesMRP(${primeiro.id})" aria-label="Abrir detalhes em tela maior" title="Abrir detalhes em tela maior">⛶</button></div></header>${resumoGeral}<div class="mrp-material-buttons">${materiaisHtml}</div></summary></details>`;
    }).join('');

    tbody.innerHTML = html || '<div class="mrp-empty-state">Nenhum material compatível com a pesquisa.</div>';
}

function renderRotas() { 
    const tbody = document.getElementById('rotas-table-body'); 
    if (!tbody) return;
    tbody.innerHTML = rotasData.map(r => { 
        let statusHtml = ''; let btnAcoes = ''; 
        const status = String(r.status || 'pendente').trim().toLowerCase();
        if(status === 'pendente') { statusHtml = '<span class="status pendente">Pendente</span>'; btnAcoes = `<button class="btn rota-acao-concluir" onclick="alterarStatusRota(${r.id}, 'concluido')">Concluir</button>`; } 
        else if(status === 'em_rota') { statusHtml = '<span class="status cotacao" style="background-color: rgba(14, 165, 233, 0.2); color: #7dd3fc;">Em Rota</span>'; btnAcoes = `<button class="btn rota-acao-concluir" onclick="alterarStatusRota(${r.id}, 'concluido')">Concluir</button>`; } 
        else if(status === 'concluido') { statusHtml = '<span class="status entregue">Concluído</span>'; btnAcoes = `<button class="btn btn-outline" style="padding:4px 8px; font-size:0.75rem;" onclick="alterarStatusRota(${r.id}, 'pendente')">Reabrir</button>`; }
        else { statusHtml = `<span class="status pendente">${escapeHTML(r.status || 'Pendente')}</span>`; btnAcoes = `<button class="btn rota-acao-concluir" onclick="alterarStatusRota(${r.id}, 'concluido')">Concluir</button>`; }
        const mapaHtml = r.localizacao_mapa ? `<button class="btn btn-outline" style="padding:4px 8px; font-size:0.75rem;" onclick="abrirMapaRota(${r.id})">📍 GPS</button>` : '-';
        btnAcoes += ` <button class="btn btn-outline" style="padding:4px 8px; font-size:0.75rem;" onclick="editarRota(${r.id})">Editar</button><button class="btn btn-outline" style="padding:4px 8px; font-size:0.75rem; color:var(--danger-color);" onclick="excluirRota(${r.id})">Excluir</button>`;
        return `<tr><td><input type="checkbox" class="rota-selecao" data-rota-id="${r.id}" ${rotasSelecionadas.has(r.id) ? 'checked' : ''} onchange="alternarRota(${r.id}, this.checked)" aria-label="Selecionar destino"></td><td>${escapeHTML(r.data_prevista.split('-').reverse().join('/'))}</td><td>${escapeHTML(r.motorista)}</td><td>${escapeHTML(r.destino_fornecedor)}</td><td>${escapeHTML(r.endereco) || '-'}</td><td>${mapaHtml}</td><td>${escapeHTML(r.po_ref) || '-'}</td><td>${statusHtml}</td><td title="${escapeHTML(r.observacoes)}">${escapeHTML(r.observacoes) || '-'}</td><td>${btnAcoes}</td></tr>`; 
    }).join('') || `<tr><td colspan="10" style="text-align:center;">Nenhuma rota agendada.</td></tr>`; 
    const seletorTodas = document.getElementById('selecionar-todas-rotas');
    if (seletorTodas) seletorTodas.checked = rotasData.length > 0 && rotasData.every(r => rotasSelecionadas.has(r.id));
}

function alternarRota(id, marcada) { if (marcada) rotasSelecionadas.add(id); else rotasSelecionadas.delete(id); renderRotas(); }
function editarRota(id) { const rota = rotasData.find(item => item.id === id); if (!rota) return; document.getElementById('formNovaRota').reset(); document.getElementById('rota_edit_id').value = rota.id; document.getElementById('rota_data').value = rota.data_prevista; document.getElementById('rota_motorista').value = rota.motorista; document.getElementById('rota_destino').value = rota.destino_fornecedor; document.getElementById('rota_endereco').value = rota.endereco || ''; document.getElementById('rota_localizacao_mapa').value = rota.localizacao_mapa || ''; document.getElementById('rota_po').value = rota.po_ref || ''; document.getElementById('rota_obs').value = rota.observacoes || ''; document.getElementById('tituloModalRota').textContent = 'Editar Rota de Coleta'; document.getElementById('botaoSalvarRota').textContent = 'Salvar Alterações'; document.getElementById('modalNovaRota').classList.add('active'); }
async function excluirRota(id) { if (!await confirmarAcao('Confirma excluir esta rota do motorista? Esta ação não pode ser desfeita.')) return; try { const res = await fetch(`/api/v1/rotas/${id}`, { method: 'DELETE' }); const resultado = await res.json(); if (res.ok) { rotasSelecionadas.delete(id); await carregarRotas(); } else alert(resultado.erro || 'Não foi possível excluir a rota.'); } catch (err) { console.error(err); alert('Não foi possível conectar ao servidor.'); } }
function alternarTodasRotas(marcada) { rotasData.forEach(r => marcada ? rotasSelecionadas.add(r.id) : rotasSelecionadas.delete(r.id)); renderRotas(); }
function obterRotasSelecionadas() { return rotasData.filter(r => rotasSelecionadas.has(r.id)); }
function formatarDataRota(data) { return data ? data.split('-').reverse().join('/') : '-'; }
function abrirMapaRota(id) { const rota = rotasData.find(item => item.id === id); if (rota?.localizacao_mapa) window.open(rota.localizacao_mapa, '_blank', 'noopener,noreferrer'); }
function rotaTemRestricao(rota) { return /(hor[aá]rio|hora|prioridade|urgente|urg[eê]ncia|at[eé] às|até as)/i.test(rota.observacoes || ''); }
function textoNormalizadoRota(valor) { return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function rotaEhDeCaruaru(rota) { return textoNormalizadoRota(`${rota.endereco || ''} ${rota.destino_fornecedor}`).includes('caruaru'); }
function organizarRotasParaPercurso(rotas) {
    if (rotas.some(rotaTemRestricao)) return rotas;
    const foraDeCaruaru = rotas.filter(rota => !rotaEhDeCaruaru(rota));
    const emCaruaru = rotas.filter(rota => rotaEhDeCaruaru(rota));
    return [...foraDeCaruaru, ...emCaruaru];
}
function linkRotaCompleta(rotas) {
    if (!rotas.length) return '';
    const fila = organizarRotasParaPercurso(rotas);
    const enderecos = fila.map(r => r.endereco || r.destino_fornecedor);
    const parametros = new URLSearchParams({ origin: ENDERECO_BASE_ROTA, destination: ENDERECO_BASE_ROTA });
    parametros.set('waypoints', enderecos.join('|'));
    return `https://www.google.com/maps/dir/?api=1&${parametros.toString()}`;
}
function nomeOrdemRota(rotas) { return rotas.some(rotaTemRestricao) ? 'ordem marcada (horário/prioridade)' : 'fora de Caruaru primeiro; Caruaru no retorno'; }
function abrirRotaCompletaSelecionada() {
    const rotas = obterRotasSelecionadas();
    if (!rotas.length) { alert('Marque pelo menos um destino para abrir a rota no GPS.'); return; }
    window.open(linkRotaCompleta(rotas), '_blank', 'noopener,noreferrer');
}
function camposPreenchidosRota(r) {
    const itens = [];
    const campos = [
        { label: 'Data', value: formatarDataRota(r.data_prevista) },
        { label: 'Endereço', value: r.endereco },
        { label: 'GPS', value: r.localizacao_mapa },
        { label: 'Referência', value: r.po_ref },
        { label: 'Status', value: r.status },
        { label: 'Observações', value: r.observacoes }
    ];

    campos.forEach(({ label, value }) => {
        if (typeof value === 'string' ? value.trim() : value != null && value !== '') {
            itens.push({ label, value: String(value).trim() });
        }
    });

    return itens;
}

function textoRotas(rotas) {
    const fila = organizarRotasParaPercurso(rotas);
    return `Rota completa no GPS: ${linkRotaCompleta(rotas)}\n\n${fila.map((r, indice) => {
        const campos = camposPreenchidosRota(r);
        const linhas = campos.map(({ label, value }) => `${label}: ${label === 'GPS' ? value : value}`).join('\n');
        return `${indice + 1}. ${r.destino_fornecedor}\n${linhas}`;
    }).join('\n\n')}`;
}
function imprimirRotasSelecionadas() {
    const rotas = obterRotasSelecionadas();
    if (!rotas.length) { alert('Marque pelo menos um destino para imprimir a rota.'); return; }
    const janela = window.open('', '_blank', 'width=900,height=700');
    if (!janela) { alert('Permita pop-ups para imprimir a rota.'); return; }
    const fila = organizarRotasParaPercurso(rotas);
    const linhas = fila.map((r, indice) => {
        const campos = camposPreenchidosRota(r);
        const htmlCampos = campos.map(({ label, value }) => {
            if (label === 'GPS' && value) {
                return `<strong>GPS:</strong> <a href="${escapeHTML(value)}">Abrir localização</a>`;
            }
            return `<strong>${escapeHTML(label)}:</strong> ${escapeHTML(value)}`;
        }).join('<br>');
        return `<section><h2>${indice + 1}. ${escapeHTML(r.destino_fornecedor)}</h2><p>${htmlCampos}</p></section>`;
    }).join('');
    janela.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Rota do Motorista</title><style>body{font-family:Arial,sans-serif;color:#111;padding:28px}h1{font-size:22px;border-bottom:2px solid #111;padding-bottom:10px;margin:0 0 18px 0}h2{font-size:17px;margin-bottom:8px}section{border-bottom:1px solid #bbb;padding:10px 0;page-break-inside:avoid}p{line-height:1.6;margin:0;font-size:13px}@media print{button{display:none}}</style></head><body><h1>Rota do Motorista</h1>${linhas}<script>window.onload=function(){window.print();window.onafterprint=function(){window.close()}}<\/script></body></html>`);
    janela.document.close();
}
function enviarRotasWhatsApp() {
    const rotas = obterRotasSelecionadas();
    if (!rotas.length) { alert('Marque pelo menos um destino para enviar ao WhatsApp.'); return; }
    const mensagem = `ROTA DO MOTORISTA\n\n${textoRotas(rotas)}`;
    window.open(`https://web.whatsapp.com/send?text=${encodeURIComponent(mensagem)}`, '_blank', 'noopener,noreferrer');
}
function enviarRotaDoDiaWhatsApp() {
    const hoje = new Date();
    const dataHoje = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
    const rotasDoDia = rotasData.filter(rota => rota.data_prevista === dataHoje);
    if (!rotasDoDia.length) { alert('Nenhuma rota agendada para hoje.'); return; }
    const mensagem = `ROTA DO DIA - ${formatarDataRota(dataHoje)}\n\n${textoRotas(rotasDoDia)}`;
    window.open(`https://web.whatsapp.com/send?text=${encodeURIComponent(mensagem)}`, '_blank', 'noopener,noreferrer');
}

function renderDashboardRotas() { 
    const container = document.getElementById('dashboard-rotas-list'); if(!container) return; 
    const hoje = new Date();
    const dataHoje = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
    const rotasDoDia = ordenarRotas(rotasData.filter(r => { const dataRota = String(r.data_prevista || '').trim(); const status = String(r.status || '').trim().toLowerCase(); return dataRota && dataRota <= dataHoje && status !== 'concluido'; })).slice(0, 4);
    if (rotasDoDia.length === 0) { container.innerHTML = '<span style="font-size:0.85rem; color:var(--text-body); font-style: italic;">Nenhuma rota pendente para hoje ou anteriores.</span>'; return; } 
    container.innerHTML = rotasDoDia.map(r => { 
        const status = String(r.status || 'pendente').trim().toLowerCase();
        let color = status === 'pendente' ? '#fbbf24' : status === 'concluido' ? '#16a34a' : '#38bdf8'; 
        let bgStatus = status === 'pendente' ? 'rgba(245, 158, 11, 0.15)' : status === 'concluido' ? 'rgba(22, 163, 74, 0.15)' : 'rgba(56, 189, 248, 0.15)'; 
        let statusName = status === 'pendente' ? 'Pendente' : status === 'concluido' ? 'Concluído' : 'Em Rota'; 
        return `<div style="padding: 8px 10px; border: 1px solid var(--border-color); border-radius: 6px; background-color: var(--bg-color); border-left: 4px solid ${color}; box-shadow: 0 1px 2px rgba(0,0,0,0.1);"><div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;"><strong style="font-size: 0.8rem; color: var(--text-title); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 65%;" title="${escapeHTML(r.destino_fornecedor)}">${escapeHTML(r.destino_fornecedor)}</strong><span style="font-size: 0.6rem; font-weight: bold; color: ${color}; background-color: ${bgStatus}; padding: 2px 6px; border-radius: 4px; text-transform: uppercase;">${statusName}</span></div><div style="font-size: 0.7rem; color: var(--text-body); display: flex; justify-content: space-between;"><span>🚚 ${escapeHTML(r.motorista)}</span><span>📅 ${escapeHTML(r.data_prevista.split('-').reverse().join('/'))}</span></div></div>`; 
    }).join(''); 
}

function renderUsuariosTable() { const tbody = document.getElementById('usuarios-table-body'); if (tbody) tbody.innerHTML = listaUsuarios.map(u => `<tr><td>#${u.id}</td><td>${escapeHTML(u.nome)}</td><td>${escapeHTML(u.email)}</td><td><span class="status entregue">${escapeHTML(u.perfil.toUpperCase())}</span></td><td><a onclick="deletarUsuario(${u.id})" style="cursor:pointer; color:var(--danger-color); font-weight:600;">Excluir</a></td></tr>`).join(''); }
function renderNiveisAcesso() {
    const lista = document.getElementById('niveis-existentes-lista');
    if (!lista) return;
    lista.innerHTML = niveisAcesso.map(nivel => `<div class="nivel-existente"><div><strong>${escapeHTML(nivel.nome)}</strong><small>${nivel.permissoes.length} página(s) liberada(s)</small></div><button type="button" class="btn btn-outline" onclick="editarNivel(${nivel.id})">Editar</button>${nivel.nome === 'admin' ? '' : `<button type="button" class="btn btn-outline nivel-excluir" onclick="excluirNivel(${nivel.id})">Excluir</button>`}</div>`).join('');
}
function renderPermissoesNivel(permissoes = []) {
    const lista = document.getElementById('nivel-permissoes-lista');
    if (!lista) return;
    lista.innerHTML = paginasAcesso.map(pagina => `<label><input type="checkbox" name="nivel_pagina" value="${escapeAttribute(pagina.id)}" ${permissoes.includes(pagina.id) ? 'checked' : ''}> ${escapeHTML(pagina.nome)}</label>`).join('');
}
function openModalNivel() { document.getElementById('formNivel').reset(); document.getElementById('nivel_id').value = ''; renderPermissoesNivel(['dashboard']); renderNiveisAcesso(); document.getElementById('modalNivel').classList.add('active'); }
function closeModalNivel() { document.getElementById('modalNivel').classList.remove('active'); }
function editarNivel(id) { const nivel = niveisAcesso.find(item => item.id === id); if (!nivel) return; document.getElementById('nivel_id').value = nivel.id; document.getElementById('nivel_nome').value = nivel.nome; renderPermissoesNivel(nivel.permissoes); document.getElementById('modalNivel').classList.add('active'); }
async function salvarNivel(event) { event.preventDefault(); const id = document.getElementById('nivel_id').value; const payload = { nome: document.getElementById('nivel_nome').value.trim(), permissoes: [...document.querySelectorAll('input[name="nivel_pagina"]:checked')].map(input => input.value) }; const resposta = await fetch(id ? `/api/v1/niveis/${id}` : '/api/v1/niveis', { method: id ? 'PUT' : 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) }); const resultado = await resposta.json(); if (!resposta.ok) { alert(resultado.erro || 'Não foi possível salvar o nível.'); return; } await carregarNiveisAcesso(); renderNiveisAcesso(); document.getElementById('formNivel').reset(); document.getElementById('nivel_id').value = ''; renderPermissoesNivel(['dashboard']); mostrarAviso('Nível salvo com sucesso.', 'success'); }
async function excluirNivel(id) { if (!await confirmarAcao('Excluir este nível? Usuários vinculados impedem a exclusão.')) return; const resposta = await fetch(`/api/v1/niveis/${id}`, {method: 'DELETE'}); const resultado = await resposta.json(); if (!resposta.ok) { alert(resultado.erro || 'Não foi possível excluir o nível.'); return; } await carregarNiveisAcesso(); renderNiveisAcesso(); mostrarAviso('Nível excluído.', 'success'); }

function filtrarSolicitacoes() {
    const t = (document.getElementById('search-sc')?.value || "").toLowerCase();
    const d = document.getElementById('filtro-data-sc')?.value;
    const isLeitura = currentUser && (currentUser.perfil === 'solicitante' || currentUser.perfil === 'estoque');
    
    let f = solicitacoes.filter(r => {
        const termMatch = (r.id || "").toLowerCase().includes(t) || (r.item || "").toLowerCase().includes(t);
        let dataMatch = true;
        if (d && r.data) {
            const partes = r.data.split('/');
            if(partes.length === 3) dataMatch = `${partes[2]}-${partes[1]}-${partes[0]}` === d;
        }
        return termMatch && dataMatch;
    });
    
    let html = f.map(req => {
        const acoes = req.status === 'pendente' || req.status === 'cotacao'
            ? (isLeitura ? '' : `<a onclick="abrirCotacoes('${escapeHTML(req.id)}', ${req.db_id})" style="cursor:pointer; color:var(--info-color); font-weight:600;">Cotar</a><a onclick="cancelarItem(${req.db_id}, 'SC')" style="cursor:pointer; color:var(--danger-color); font-weight:600;">Cancelar</a>`)
            : '';
        const solicitante = req.solicitante || req.setor || 'Solicitante';
        return `<tr><td><a onclick="abrirDetalhesCartao('${escapeHTML(req.id)}', 'SC')" style="cursor:pointer; color:var(--info-color); font-weight:700;">${escapeHTML(req.id)}</a></td><td>${escapeHTML(req.item)}</td><td>${escapeHTML(req.quantidade)} un</td><td>${escapeHTML(req.numero_pedido_sap || '-')}</td><td>${escapeHTML(solicitante)}</td><td>${formatStatus(req.status)}</td><td><div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">${acoes}</div></td></tr>`;
    }).join('');
    
    if (hasNextSC && t === '' && !d) {
        html += `<tr><td colspan="7" style="text-align:center; padding: 20px;"><button class="btn btn-outline" onclick="carregarSolicitacoes()" style="width: 100%; border-style: dashed; max-width: 400px; margin: 0 auto;">⬇️ Carregar Mais</button></td></tr>`;
    }
    document.getElementById('sc-table-body').innerHTML = html || `<tr><td colspan="7" style="text-align:center;">Nada encontrado.</td></tr>`;
}

function filtrarPedidos() {
    const t = (document.getElementById('search-po')?.value || "").toLowerCase();
    const d = document.getElementById('filtro-data-po')?.value;
    const podeEditar = !(currentUser && ['solicitante', 'estoque'].includes(currentUser.perfil));
    const isEstoque = currentUser && currentUser.perfil === 'estoque';

    let f = pedidos.filter(p => {
        const termMatch = (p.id || "").toLowerCase().includes(t) || (p.sc_ref || "").toLowerCase().includes(t) || (p.fornecedor || "").toLowerCase().includes(t) || (p.item || "").toLowerCase().includes(t);
        let dataMatch = true;
        if (d && p.data) {
            const partes = p.data.split('/');
            if(partes.length === 3) dataMatch = `${partes[2]}-${partes[1]}-${partes[0]}` === d;
        }
        return termMatch && dataMatch;
    });

    let html = f.map(po => `
        <tr>
            <td>${escapeHTML(po.id)} ${po.atrasado && po.status !== 'cancelado' && po.status !== 'entregue' ? '⚠️' : ''}</td>
            <td>${escapeHTML(po.sc_ref)}</td>
            <td>${escapeHTML(po.item)}</td>
            <td>${escapeHTML(po.fornecedor)}</td>
            <td>${escapeHTML(po.valor_total)}</td>
            <td>${formatStatus(po.status)}</td>
            <td>
                <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                    ${isEstoque && ['gerado', 'aprovado', 'transito'].includes(po.status) && po.status !== 'entregue' && po.status !== 'cancelado' ? `<button class="btn" type="button" style="padding:4px 8px; font-size:0.72rem; background-color:var(--success-color); color:white;" onclick="receberEntrega(${po.db_id ?? po.id})">📦 Receber</button>` : ''}
                    <button class="btn btn-outline" type="button" style="padding:4px 8px; font-size:0.72rem;" onclick="abrirModalEditarPO(${po.db_id ?? po.id})">Editar</button>
                    ${podeEditar ? `<button class="btn btn-outline" type="button" style="padding:4px 8px; font-size:0.72rem; color:var(--danger-color);" onclick="alterarStatusPedido(${po.db_id ?? po.id}, 'cancelado')">Cancelar</button>` : ''}
                </div>
            </td>
        </tr>
    `).join('');

    if (hasNextPO && t === '' && !d) {
        html += `<tr><td colspan="7" style="text-align:center; padding: 20px;"><button class="btn btn-outline" onclick="carregarPedidos()" style="width: 100%; border-style: dashed; max-width: 400px; margin: 0 auto;">⬇️ Carregar Mais</button></td></tr>`;
    }
    document.getElementById('po-table-body').innerHTML = html || `<tr><td colspan="7" style="text-align:center;">Nada encontrado.</td></tr>`;
}

async function receberEntrega(id) {
    if (!confirm('Confirma o recebimento desta entrega? O pedido será marcado como concluído.')) return;
    
    try {
        const res = await fetch(`/api/v1/pedidos/${id}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'entregue' })
        });

        if (res.ok) {
            await carregarPedidos(true);
            await carregarKPIs();
            mostrarAviso('Entrega recebida e pedido concluído com sucesso!', 'success');
            
            // Notificação nativa do Windows
            if ('Notification' in window) {
                if (Notification.permission === 'granted') {
                    new Notification('Entrega Recebida', {
                        body: '📦 O pedido foi marcado como concluído com sucesso!',
                        tag: 'recebimento-entrega',
                        requireInteraction: false
                    });
                } else if (Notification.permission !== 'denied') {
                    Notification.requestPermission().then(permission => {
                        if (permission === 'granted') {
                            new Notification('Entrega Recebida', {
                                body: '📦 O pedido foi marcado como concluído com sucesso!',
                                tag: 'recebimento-entrega',
                                requireInteraction: false
                            });
                        }
                    });
                }
            }
        } else {
            const erro = await res.json().catch(() => ({}));
            alert(erro.erro || 'Não foi possível receber a entrega.');
        }
    } catch (e) {
        console.error(e);
        alert('Erro ao conectar ao servidor.');
    }
}

async function abrirModalEditarPO(id) {
    const po = pedidos.find(item => Number(item.db_id ?? item.id) === Number(id));
    if (!po) return;

    document.getElementById('editar_po_id').value = po.db_id ?? po.id;
    document.getElementById('editar_po_item').value = po.item || '';
    document.getElementById('editar_po_fornecedor').value = po.fornecedor || '';
    document.getElementById('editar_po_valor').value = po.valor_total ? Number(String(po.valor_total).replace(/[R$\s\.]/g, '').replace(',', '.')) : '';
    document.getElementById('editar_po_prazo').value = po.prazo_dias || 7;
    document.getElementById('editar_po_status').value = po.status || 'gerado';
    document.getElementById('modalEditarPO').classList.add('active');
}

function closeModalEditarPO() {
    document.getElementById('modalEditarPO')?.classList.remove('active');
}

async function submitEditarPO(event) {
    event.preventDefault();
    const id = document.getElementById('editar_po_id').value;
    if (!id) return;

    const payload = {
        item: document.getElementById('editar_po_item').value.trim(),
        fornecedor: document.getElementById('editar_po_fornecedor').value.trim(),
        valor_total: document.getElementById('editar_po_valor').value,
        prazo_dias: document.getElementById('editar_po_prazo').value,
        status: document.getElementById('editar_po_status').value
    };

    try {
        const res = await fetch(`/api/v1/pedidos/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const resultado = await res.json().catch(() => ({}));
        if (!res.ok) {
            alert(resultado.erro || 'Não foi possível atualizar o pedido.');
            return;
        }

        closeModalEditarPO();
        await carregarPedidos(true);
        await carregarKPIs();
        mostrarAviso('Pedido atualizado com sucesso.', 'success');
    } catch (erro) {
        console.error(erro);
        alert('Não foi possível conectar ao servidor.');
    }
}

function renderKPIs() { 
    const elSc = document.getElementById('kpi-sc'); if (elSc) elSc.innerText = solicitacoes.filter(sc => sc.status === 'pendente' || sc.status === 'cotacao').length; 
    const elPo = document.getElementById('kpi-po'); if (elPo) elPo.innerText = pedidos.filter(p => p.status === 'gerado' || p.status === 'transito' || p.status === 'aprovado').length; 
    let t = 0; pedidos.forEach(po => { if (po.status !== 'cancelado' && po.valor_total) { let n = parseFloat(String(po.valor_total).replace(/[R$\s\.]/g, '').replace(',', '.')); if(!isNaN(n)) t += n; } }); 
    const elTot = document.getElementById('kpi-total'); if (elTot) elTot.innerText = t.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); 
    const elL = document.getElementById('kpi-lead'); if(elL) elL.innerText = dadosKPI.leadTimeMedio == null ? '--' : dadosKPI.leadTimeMedio + ' dias';
    const elLi = document.getElementById('kpi-lead-interno'); if(elLi) elLi.innerText = dadosKPI.leadTimeInternoMedio == null ? '--' : dadosKPI.leadTimeInternoMedio + ' dias';
    const elE = document.getElementById('kpi-emerg'); if(elE) elE.innerText = dadosKPI.taxaEmergencial + '%'; 
}

async function carregarKPIs() {
    try {
        const res = await fetch('/api/v1/dashboard/kpis');
        if (!res.ok) return;
        const kpis = await res.json();
        dadosKPI.leadTimeMedio = kpis.lead_time_externo_medio;
        dadosKPI.leadTimeInternoMedio = kpis.lead_time_interno_medio;
        dadosKPI.taxaEmergencial = kpis.taxa_emergencial;
        renderKPIs();
    } catch (err) { console.error(err); }
}

function renderCharts() { 
    const isDark = document.documentElement.getAttribute("data-theme") === "dark"; 
    if (chartStatusInstance) chartStatusInstance.destroy(); 
    let st = { pendente:0, cotacao:0, gerado:0, transito:0, entregue:0, cancelado:0 }; 
    solicitacoes.forEach(s => st[s.status]++); 
    pedidos.forEach(p => st[p.status === 'aprovado' ? 'gerado' : p.status]++); 
    const bgStatusColors = isDark ? ['rgba(245, 158, 11, 0.8)', 'rgba(56, 189, 248, 0.8)', 'rgba(148, 163, 184, 0.8)', 'rgba(168, 85, 247, 0.8)', 'rgba(16, 185, 129, 0.8)', 'rgba(71, 85, 105, 0.8)'] : ['#fef3c7', '#e0f2fe', '#f1f5f9', '#fae8ff', '#d1fae5', '#f1f5f9']; 
    const borderStatusColors = isDark ? '#151e32' : ['#b45309', '#0369a1', '#0f172a', '#86198f', '#065f46', '#94a3b8']; 
    
    const ctxSt = document.getElementById('chartStatus');
    if(ctxSt) {
        chartStatusInstance = new Chart(ctxSt, { type: 'doughnut', data: { labels: ['Pendentes', 'Em Cotação', 'Pedidos', 'Realizados', 'Concluídos', 'Cancelados'], datasets: [{ data: [st.pendente, st.cotacao, st.gerado, st.transito, st.entregue, st.cancelado], backgroundColor: bgStatusColors, borderColor: borderStatusColors, borderWidth: 1 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { title: { display: true, text: 'Distribuição Operacional' }, legend: { position: 'right' } } } }); 
    }

    if (chartGastosInstance) chartGastosInstance.destroy(); 
    let gf = {}; 
    pedidos.forEach(p => { if(p.status !== 'cancelado' && p.valor_total) { let n = parseFloat(String(p.valor_total).replace(/[R$\s\.]/g, '').replace(',', '.')); if(!isNaN(n)) gf[p.fornecedor] = (gf[p.fornecedor]||0) + n; } }); 
    const nomesFornecedores = Object.keys(gf);
    const nomesResumidos = nomesFornecedores.map(nome => {
        const partes = nome.trim().split(/\s+/);
        return partes.length > 2 ? `${partes.slice(0, 2).join(' ')}...` : nome.length > 24 ? `${nome.slice(0, 21)}...` : nome;
    });
    
    const ctxGf = document.getElementById('chartGastosFornecedor');
    if(ctxGf) {
        chartGastosInstance = new Chart(ctxGf, { type: 'bar', data: { labels: nomesResumidos.map(nome => escapeHTML(nome)), datasets: [{ label: 'R$', data: Object.values(gf), backgroundColor: isDark ? '#3b82f6' : '#0f172a', borderRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { title: { display: true, text: 'Gasto por Fornecedor (R$)' }, legend: { display: false }, tooltip: { callbacks: { label: contexto => `${nomesFornecedores[contexto.dataIndex]}: R$ ${contexto.raw.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` } } }, scales: { y: { beginAtZero: true } } } }); 
    }
}

// === CONTROLES DE MODAIS E INICIALIZAÇÃO ===
function openModalUsuario() { preencherSelectNiveis(); document.getElementById('modal-usuario-titulo').innerText = "Novo Usuário"; document.getElementById('formUsuario').reset(); document.getElementById('modalUsuario').classList.add('active'); }
function closeModalUsuario() { document.getElementById('modalUsuario').classList.remove('active'); }
async function deletarUsuario(id) { if (await confirmarAcao("Confirma excluir este usuário? Esta ação não pode ser desfeita.")) { await fetch(`/api/v1/usuarios/${id}`, { method: 'DELETE' }); await carregarUsuarios(); } }
function formatStatus(status) { const nomes = { pendente: 'Solicitação de compra', cotacao: 'Em cotação', aprovado: 'Pedido gerado', gerado: 'Pedido gerado', transito: 'Em trânsito', entregue: 'Entregue', cancelado: 'Cancelado' }; return `<span class="status ${status}">${nomes[status] || status}</span>`; }
function switchView(viewId, navItem = null) {
    const view = document.getElementById(`view-${viewId}`);
    if (!view) {
        console.error(`Seção não encontrada: view-${viewId}`);
        return;
    }
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    view.classList.add('active');
    if (navItem) navItem.classList.add('active');
    if (viewId === 'itens') carregarItens().catch(() => {});
}

// Modais SC e PO
async function openModal() { await carregarItens().catch(() => {}); document.getElementById('formSC').reset(); resetarItensSolicitacao(); fecharSugestoesItens(); if (document.getElementById('item-search-clear')) document.getElementById('item-search-clear').classList.remove('visible'); document.getElementById('modalSC').classList.add('active'); }
function closeModal() { document.getElementById('modalSC').classList.remove('active'); resetarItensSolicitacao(); }
function pesquisarItens(valor) {
    const termo = valor.trim().toLowerCase();
    const lista = document.getElementById('item-suggestions');
    const hint = document.getElementById('item-search-hint');
    itemSuggestionIndex = -1;
    if (!lista) return;
    if (termo.length < 2) { fecharSugestoesItens(); if (hint) hint.textContent = 'Digite pelo menos 2 caracteres para pesquisar.'; return; }
    const resultados = itens.filter(item => `${item.codigo} ${item.descricao}`.toLowerCase().includes(termo)).slice(0, 40);
    if (!resultados.length) { lista.innerHTML = '<div class="item-suggestions-empty">Nenhum item cadastrado corresponde à pesquisa.</div>'; lista.classList.add('visible'); if (hint) hint.textContent = 'Você pode informar o item livremente e solicitá-lo mesmo sem cadastro.'; return; }
    lista.innerHTML = resultados.map((item, indice) => `<button type="button" class="item-suggestion" role="option" data-index="${indice}" data-value="${escapeHTML(item.codigo)}" title="${escapeAttribute(item.descricao)}"><span class="item-suggestion-code">${escapeHTML(item.codigo)}</span><span class="item-suggestion-description" title="${escapeAttribute(item.descricao)}">${escapeHTML(item.descricao)}</span></button>`).join('');
    lista.classList.add('visible');
    lista.querySelectorAll('[data-value]').forEach(botao => botao.addEventListener('click', () => selecionarItem(botao.dataset.value)));
    if (hint) hint.textContent = `${resultados.length}${resultados.length === 40 ? '+' : ''} item(ns) encontrado(s).`;
}
function selecionarItem(codigo) { const input = document.getElementById('item'); if (input) { input.value = codigo; document.getElementById('item-search-clear').classList.add('visible'); } fecharSugestoesItens(); }
function fecharSugestoesItens() { const lista = document.getElementById('item-suggestions'); if (lista) { lista.classList.remove('visible'); lista.innerHTML = ''; } }
function fecharSugestoesPO() {
    ['novo-po-item-suggestions', 'novo-po-fornecedor-suggestions', 'compra-mrp-fornecedor-suggestions'].forEach(id => {
        const lista = document.getElementById(id);
        if (lista) { lista.classList.remove('visible'); lista.innerHTML = ''; }
    });
    poItemSuggestionIndex = -1;
    poFornecedorSuggestionIndex = -1;
}

function pesquisarItemPO(valor) {
    const termo = valor.trim().toLowerCase();
    const lista = document.getElementById('novo-po-item-suggestions');
    poItemSuggestionIndex = -1;
    if (!lista) return;
    if (termo.length < 2) { lista.classList.remove('visible'); lista.innerHTML = ''; return; }
    const resultados = itens.filter(item => `${item.codigo} ${item.descricao}`.toLowerCase().includes(termo)).slice(0, 30);
    lista.innerHTML = resultados.length ? resultados.map(item => `<button type="button" class="item-suggestion" role="option" data-value="${escapeHTML(item.descricao)}" title="${escapeAttribute(item.descricao)}"><span class="item-suggestion-code">${escapeHTML(item.codigo)}</span><span class="item-suggestion-description">${escapeHTML(item.descricao)}</span></button>`).join('') : '<div class="item-suggestions-empty">Nenhum item encontrado.</div>';
    lista.classList.add('visible');
    lista.querySelectorAll('[data-value]').forEach(botao => botao.addEventListener('click', () => { document.getElementById('novo_po_item').value = botao.dataset.value; fecharSugestoesPO(); }));
}

function pesquisarFornecedorPO(valor) {
    const termo = valor.trim().toLowerCase();
    const lista = document.getElementById('novo-po-fornecedor-suggestions');
    poFornecedorSuggestionIndex = -1;
    if (!lista) return;
    if (termo.length < 2) { lista.classList.remove('visible'); lista.innerHTML = ''; return; }
    const resultados = fornecedores.filter(fornecedor => `${fornecedor.razao_social} ${fornecedor.nome_fantasia || ''} ${fornecedor.codigo || ''} ${fornecedor.cnpj || ''}`.toLowerCase().includes(termo)).slice(0, 30);
    lista.innerHTML = resultados.length ? resultados.map(fornecedor => `<button type="button" class="item-suggestion" role="option" data-value="${escapeHTML(fornecedor.razao_social)}"><span class="item-suggestion-code">${escapeHTML(fornecedor.codigo || fornecedor.cnpj || 'Fornecedor')}</span><span class="item-suggestion-description">${escapeHTML(fornecedor.razao_social)}</span></button>`).join('') : '<div class="item-suggestions-empty">Nenhum fornecedor encontrado.</div>';
    lista.classList.add('visible');
    lista.querySelectorAll('[data-value]').forEach(botao => botao.addEventListener('click', () => { document.getElementById('novo_po_fornecedor').value = botao.dataset.value; fecharSugestoesPO(); }));
}

function navegarSugestoesPO(event, tipo) {
    const lista = document.getElementById(tipo === 'item' ? 'novo-po-item-suggestions' : 'novo-po-fornecedor-suggestions');
    const opcoes = lista ? [...lista.querySelectorAll('.item-suggestion')] : [];
    if (!opcoes.length) return;
    let indice = tipo === 'item' ? poItemSuggestionIndex : poFornecedorSuggestionIndex;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        indice = (indice + (event.key === 'ArrowDown' ? 1 : opcoes.length - 1)) % opcoes.length;
        opcoes.forEach((opcao, posicao) => opcao.classList.toggle('active', posicao === indice));
        opcoes[indice].scrollIntoView({block: 'nearest'});
    } else if (event.key === 'Enter' && indice >= 0) {
        event.preventDefault();
        opcoes[indice].click();
    } else if (event.key === 'Escape') fecharSugestoesPO();
    if (tipo === 'item') poItemSuggestionIndex = indice;
    else poFornecedorSuggestionIndex = indice;
}
function navegarSugestoesItens(event) { const lista = document.getElementById('item-suggestions'); const opcoes = lista ? [...lista.querySelectorAll('.item-suggestion')] : []; if (!opcoes.length) return; if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); itemSuggestionIndex = (itemSuggestionIndex + (event.key === 'ArrowDown' ? 1 : opcoes.length - 1)) % opcoes.length; opcoes.forEach((opcao, indice) => opcao.classList.toggle('active', indice === itemSuggestionIndex)); opcoes[itemSuggestionIndex].scrollIntoView({ block: 'nearest' }); } else if (event.key === 'Enter' && itemSuggestionIndex >= 0) { event.preventDefault(); selecionarItem(opcoes[itemSuggestionIndex].dataset.value); } else if (event.key === 'Escape') fecharSugestoesItens(); }
async function openModalItem() { document.getElementById('formItem').reset(); document.getElementById('item_edit_id').value = ''; document.getElementById('tituloModalItem').textContent = 'Novo Item'; document.getElementById('item_unidade').value = 'UN'; const numeros = itens.map(item => { const correspondencia = String(item.codigo || '').match(/^(.*?)(\d+)$/); return correspondencia ? { prefixo: correspondencia[1], numero: Number(correspondencia[2]) } : null; }).filter(Boolean); const maior = numeros.reduce((atual, item) => item.numero > atual.numero ? item : atual, { prefixo: 'U', numero: 0 }); const codigoInicial = `${maior.prefixo || 'U'}${String(maior.numero + 1).padStart(4, '0')}`; const campoCodigo = document.getElementById('item_codigo'); campoCodigo.value = codigoInicial; document.getElementById('modalItem').classList.add('active'); try { const resposta = await fetch('/api/v1/itens/proximo-codigo', { cache: 'no-store' }); if (resposta.ok && campoCodigo.value === codigoInicial) { const dados = await resposta.json(); campoCodigo.value = dados.codigo || codigoInicial; } } catch (erro) { console.error('Não foi possível atualizar o código do item:', erro); } }
function closeModalItem() { retornarAoPOAposCadastroItem = false; document.getElementById('modalItem').classList.remove('active'); }
function abrirImportacaoItens() { document.getElementById('formImportacaoItens').reset(); document.getElementById('modalImportacaoItens').classList.add('active'); }
function closeImportacaoItens() { document.getElementById('modalImportacaoItens').classList.remove('active'); }
function abrirImportacaoFornecedores() { document.getElementById('formImportacaoFornecedores').reset(); document.getElementById('modalImportacaoFornecedores').classList.add('active'); }
function closeImportacaoFornecedores() { document.getElementById('modalImportacaoFornecedores').classList.remove('active'); }
async function openModalNovoPO() {
    await carregarItens().catch(() => {});
    if (!fornecedores.length) await carregarFornecedores();
    document.getElementById('formNovoPO').reset();
    fecharSugestoesPO();
    document.getElementById('modalNovoPO').classList.add('active');
    document.getElementById('novo_po_item').focus();
}
function closeModalNovoPO() { document.getElementById('modalNovoPO').classList.remove('active'); }
function abrirCadastroItemAPartirDoPO() { retornarAoPOAposCadastroItem = true; openModalItem(); }

// Modais Fornecedor
function openModalFornecedor() { document.getElementById('formFornecedor').reset(); document.getElementById('fornecedor_edit_id').value = ''; document.getElementById('tituloModalFornecedor').textContent = 'Homologar Novo Fornecedor'; document.getElementById('ativo_fornecedor').checked = true; document.getElementById('modalFornecedor').classList.add('active'); }
function closeModalFornecedor() { document.getElementById('modalFornecedor').classList.remove('active'); }
function closeModalCotacao() { document.getElementById('modalCotacao').classList.remove('active'); }

// Modais Detalhes e Kanban
function closeModalDetalhes() { document.getElementById('modalDetalhesCartao').classList.remove('active'); }

// Modais MRP
async function openModalNovoMRP() {
    await carregarItens().catch(() => {});
    document.getElementById('formNovoMRP').reset();
    document.getElementById('novo_mrp_item_id').value = '';
    document.getElementById('novo_mrp_nome').value = '';
    document.getElementById('novo_mrp_produto_nome').focus();
    document.getElementById('modalNovoMRP').classList.add('active');
}
function closeModalNovoMRP() { document.getElementById('modalNovoMRP').classList.remove('active'); }
function openModalNovoPedidoMRP() { 
    document.getElementById('formNovoPedidoMRP').reset();
    document.getElementById('pedido_mrp_material_id').value = '';
    document.getElementById('pedido_mrp_material').value = '';
    document.getElementById('pedido_mrp_consumo').value = '';
    document.getElementById('pedido_mrp_consumo_total').value = '';
    document.getElementById('pedido-mrp-materiais-group').style.display = 'none';
    document.getElementById('pedido-mrp-materiais-lista').innerHTML = '';
    document.getElementById('modalNovoPedidoMRP').classList.add('active'); 
    document.getElementById('pedido_mrp_produto_input').focus();
}
function closeModalNovoPedidoMRP() { document.getElementById('modalNovoPedidoMRP').classList.remove('active'); }
function closeModalEditMRP() { document.getElementById('modalEditMRP').classList.remove('active'); }

// Modais Rotas
function openModalNovaRota() { document.getElementById('formNovaRota').reset(); document.getElementById('rota_edit_id').value = ''; document.getElementById('tituloModalRota').textContent = 'Agendar Rota de Coleta'; document.getElementById('botaoSalvarRota').textContent = 'Agendar Rota'; document.getElementById('modalNovaRota').classList.add('active'); }
function closeModalNovaRota() { document.getElementById('modalNovaRota').classList.remove('active'); }

// Expansão de Fornecedores com Histórico de Ocorrências
function toggleExpandirFornecedor(id, event) {
    if (event.target.tagName === 'BUTTON' || event.target.closest('button')) return;
    const linhaExpansao = document.getElementById(`expansao-forn-${id}`);
    if (linhaExpansao) {
        const expandir = linhaExpansao.style.display === 'none';
        fornecedorExpandidoId = expandir ? String(id) : null;
        linhaExpansao.style.display = expandir ? 'table-row' : 'none';
    }
}

function mudarPaginaFornecedores(delta) {
    const listaFornecedores = obterFornecedoresFiltrados();
    const totalPaginas = Math.max(1, Math.ceil(listaFornecedores.length / fornecedoresPorPagina));
    const novaPagina = Math.min(totalPaginas, Math.max(1, paginaFornecedores + delta));
    if (novaPagina === paginaFornecedores) return;
    paginaFornecedores = novaPagina;
    fornecedorExpandidoId = null;
    renderTables();
}

function obterFornecedoresFiltrados() {
    const termo = String(document.getElementById('search-fornecedor')?.value || '').trim().toLowerCase();
    if (!termo) return fornecedores;
    return fornecedores.filter(fornecedor => `${fornecedor.razao_social} ${fornecedor.nome_fantasia || ''} ${fornecedor.codigo || ''} ${fornecedor.cnpj || ''}`.toLowerCase().includes(termo));
}

function fecharSugestoesFornecedorTabela() {
    const lista = document.getElementById('fornecedor-table-suggestions');
    if (lista) { lista.classList.remove('visible'); lista.innerHTML = ''; }
    fornecedorTabelaSuggestionIndex = -1;
}

function selecionarFornecedorTabela(id) {
    const fornecedor = fornecedores.find(item => item.id === Number(id));
    const campo = document.getElementById('search-fornecedor');
    if (!fornecedor || !campo) return;
    campo.value = fornecedor.razao_social;
    paginaFornecedores = 1;
    fornecedorExpandidoId = null;
    fecharSugestoesFornecedorTabela();
    renderTables();
}

function pesquisarFornecedorTabela(valor) {
    const lista = document.getElementById('fornecedor-table-suggestions');
    const termo = String(valor || '').trim().toLowerCase();
    fornecedorTabelaSuggestionIndex = -1;
    if (!lista) return;
    paginaFornecedores = 1;
    fornecedorExpandidoId = null;
    if (termo.length < 2) { fecharSugestoesFornecedorTabela(); renderTables(); return; }
    const resultados = fornecedores.filter(fornecedor => `${fornecedor.razao_social} ${fornecedor.nome_fantasia || ''} ${fornecedor.codigo || ''} ${fornecedor.cnpj || ''}`.toLowerCase().includes(termo)).slice(0, 30);
    lista.innerHTML = resultados.length
        ? resultados.map(fornecedor => `<button type="button" class="item-suggestion" role="option" data-id="${fornecedor.id}"><span class="item-suggestion-code">${escapeHTML(fornecedor.codigo || fornecedor.cnpj || 'Fornecedor')}</span><span class="item-suggestion-description">${escapeHTML(fornecedor.razao_social)}</span></button>`).join('')
        : '<div class="item-suggestions-empty">Nenhum fornecedor encontrado.</div>';
    lista.classList.add('visible');
    lista.querySelectorAll('[data-id]').forEach(botao => botao.addEventListener('click', () => selecionarFornecedorTabela(botao.dataset.id)));
    renderTables();
}

function navegarSugestoesFornecedorTabela(event) {
    const lista = document.getElementById('fornecedor-table-suggestions');
    const opcoes = lista ? [...lista.querySelectorAll('.item-suggestion')] : [];
    if (event.key === 'Escape') { fecharSugestoesFornecedorTabela(); return; }
    if (!opcoes.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        fornecedorTabelaSuggestionIndex = (fornecedorTabelaSuggestionIndex + (event.key === 'ArrowDown' ? 1 : opcoes.length - 1)) % opcoes.length;
        opcoes.forEach((opcao, indice) => opcao.classList.toggle('active', indice === fornecedorTabelaSuggestionIndex));
        opcoes[fornecedorTabelaSuggestionIndex].scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter' && fornecedorTabelaSuggestionIndex >= 0) {
        event.preventDefault();
        selecionarFornecedorTabela(opcoes[fornecedorTabelaSuggestionIndex].dataset.id);
    }
}

function renderTables() {
    if (atualizacaoTempoRealEmLote) return;
    renderKanban(); renderCharts(); renderKPIs(); renderMRP(); renderRotas(); renderDashboardRotas(); renderDashboardPrevisao(); filtrarSolicitacoes(); filtrarPedidos(); 
    
    const tbodyForn = document.getElementById('fornecedores-table-body');
    if (tbodyForn) {
        const listaFornecedores = obterFornecedoresFiltrados();
        if (listaFornecedores.length === 0) {
            const termoFornecedor = String(document.getElementById('search-fornecedor')?.value || '').trim();
            tbodyForn.innerHTML = `<tr><td colspan="9" style="text-align:center;">${termoFornecedor ? 'Nenhum fornecedor encontrado.' : 'Nenhum fornecedor homologado.'}</td></tr>`;
        } else {
            const inicioPagina = (paginaFornecedores - 1) * fornecedoresPorPagina;
            tbodyForn.innerHTML = listaFornecedores.slice(inicioPagina, inicioPagina + fornecedoresPorPagina).map(f => {
                const qtdOco = f.ocorrencias ? f.ocorrencias.length : 0;
                let ocorrenciasHtml = '';
                if (qtdOco > 0) {
                    ocorrenciasHtml = f.ocorrencias.map(o => `
                        <div style="font-size: 0.8rem; padding: 8px 12px; background: var(--bg-color); border-bottom: 1px solid var(--border-color); border-radius: 4px; margin-bottom: 4px;">
                            <strong style="color: var(--text-title);">🕒 ${escapeHTML(o.data)}</strong> — ${escapeHTML(o.texto)}
                        </div>
                    `).join('');
                } else {
                    ocorrenciasHtml = `<span style="font-size: 0.8rem; color: var(--text-body); font-style: italic;">Nenhum defeito ou falha registrada para este fornecedor.</span>`;
                }

                return `
                    <tr style="cursor: pointer;" onclick="toggleExpandirFornecedor(${f.id}, event)">
                        <td>${escapeHTML(f.cnpj)}</td>
                        <td>${escapeHTML(f.codigo || '-')}</td>
                        <td><strong>${escapeHTML(f.razao_social)}</strong></td>
                        <td>${escapeHTML(f.nome_fantasia || '-')}</td>
                        <td>${escapeHTML(f.uf || '-')}</td>
                        <td>${escapeHTML(f.cidade || '-')}</td>
                        <td>${f.ativo ? 'Sim' : 'Não'}</td>
                        <td>${escapeHTML(f.avaliacao)} <span style="font-size: 0.75rem; color: var(--text-body); margin-left: 6px;">(${qtdOco} ocorrências)</span></td>
                        <td style="text-align: right;" onclick="event.stopPropagation()">
                            <button class="btn btn-outline" style="padding:4px 8px; font-size:0.75rem; color:var(--danger-color);" onclick="registrarProblemaFornecedor(${f.id})">⚠️ Registrar Problema</button>
                            <button class="btn btn-outline" style="padding:4px 8px; font-size:0.75rem;" onclick="editarFornecedor(${JSON.stringify(f).replace(/"/g, '&quot;')})">Editar</button>
                            <button class="btn btn-outline" style="padding:4px 8px; font-size:0.75rem; color:var(--danger-color);" onclick="excluirRegistro('/api/v1/fornecedores/${f.id}', 'Excluir este fornecedor?', carregarFornecedores)">Excluir</button>
                        </td>
                    </tr>
                    <tr id="expansao-forn-${f.id}" style="display: ${String(f.id) === fornecedorExpandidoId ? 'table-row' : 'none'}; background-color: rgba(0,0,0,0.02);">
                        <td colspan="9" style="padding: 15px 25px;">
                            <div style="font-weight: 600; font-size: 0.85rem; color: var(--text-title); margin-bottom: 8px;">📋 Histórico de Ocorrências e Falhas:</div>
                            <div style="display: flex; flex-direction: column; gap: 4px; max-height: 200px; overflow-y: auto;">
                                ${ocorrenciasHtml}
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        const paginacao = document.getElementById('fornecedores-paginacao');
        if (paginacao) {
            const totalPaginas = Math.max(1, Math.ceil(listaFornecedores.length / fornecedoresPorPagina));
            paginaFornecedores = Math.min(paginaFornecedores, totalPaginas);
            paginacao.innerHTML = `
                <button type="button" class="btn btn-outline" onclick="mudarPaginaFornecedores(-1)" ${paginaFornecedores === 1 ? 'disabled' : ''}>Anterior</button>
                <span>Página ${paginaFornecedores} de ${totalPaginas} (${listaFornecedores.length} fornecedores)</span>
                <button type="button" class="btn btn-outline" onclick="mudarPaginaFornecedores(1)" ${paginaFornecedores === totalPaginas ? 'disabled' : ''}>Próxima</button>
            `;
        }
    }
    
    renderUsuariosTable();
}

function renderItens() {
    const tbody = document.getElementById('itens-table-body');
    if (!tbody) return;
    const busca = (document.getElementById('search-itens')?.value || '').toLowerCase();
    const filtrados = itens.filter(i => [i.codigo, i.descricao, i.grupo, i.fabricante].some(v => String(v || '').toLowerCase().includes(busca)));
    const exibidos = filtrados.slice(0, limiteRenderizacaoItens);
    if (!filtrados.length) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">Nenhum item cadastrado.</td></tr>';
        return;
    }
    const linhas = exibidos.map(i => `<tr><td>${escapeHTML(i.codigo)}</td><td><strong>${escapeHTML(i.descricao)}</strong></td><td>${escapeHTML(i.estoque)}</td><td>${escapeHTML(i.grupo)}</td><td>${escapeHTML(i.fabricante)}</td><td>${escapeHTML(i.unidade)}</td><td>${i.ultimo_preco == null ? '-' : Number(i.ultimo_preco).toLocaleString('pt-BR', {style:'currency', currency:'BRL'})}</td><td><button class="btn btn-outline" style="padding:4px 8px; font-size:.75rem;" onclick="editarItem(${JSON.stringify(i).replace(/"/g, '&quot;')})">Editar</button> <button class="btn btn-outline" style="padding:4px 8px; font-size:.75rem; color:var(--danger-color);" onclick="excluirRegistro('/api/v1/itens/${i.id}', 'Excluir este item?', carregarItens)">Excluir</button></td></tr>`);
    if (exibidos.length < filtrados.length) {
        linhas.push(`<tr><td colspan="8" style="text-align:center; padding:14px;"><button class="btn btn-outline" type="button" onclick="carregarMaisItens()">Carregar mais (${filtrados.length - exibidos.length} restantes)</button></td></tr>`);
    }
    tbody.innerHTML = linhas.join('');
}
function carregarMaisItens() { limiteRenderizacaoItens += 100; renderItens(); }
function filtrarItens() { limiteRenderizacaoItens = 100; renderItens(); }
function limparPesquisa(id, callback) { const campo = document.getElementById(id); if (campo) { campo.value = ''; campo.focus(); } if (callback) callback(); }

function aplicarDebounce(funcao, atraso = 180) {
    let temporizador;
    return (...argumentos) => {
        clearTimeout(temporizador);
        temporizador = setTimeout(() => funcao(...argumentos), atraso);
    };
}

filtrarSolicitacoes = aplicarDebounce(filtrarSolicitacoes);
filtrarPedidos = aplicarDebounce(filtrarPedidos);
filtrarItens = aplicarDebounce(filtrarItens);
filtrarMRP = aplicarDebounce(filtrarMRP);

window.onload = async () => { 
    loadTheme(); carregarEstadoSidebar(); await carregarUsuarioLogado(); await carregarNiveisAcesso(); await carregarUsuarios(); 
    iniciarAtualizacaoTempoReal();
    const inputImagemLegacy = document.getElementById('comercial_imagem');
    if (inputImagemLegacy) {
        inputImagemLegacy.addEventListener('change', event => mostrarPreviewImagemComercial(event.target.files[0]));
    }
    const inputNovoAnexo = document.getElementById('novo-anexo-file');
    const nomeNovoAnexo = document.getElementById('novo-anexo-nome');
    if (inputNovoAnexo && nomeNovoAnexo) {
        inputNovoAnexo.addEventListener('change', () => {
            const arquivo = inputNovoAnexo.files?.[0];
            nomeNovoAnexo.textContent = arquivo ? arquivo.name : 'Selecionar arquivo';
            inputNovoAnexo.previousElementSibling?.classList.toggle('is-selected', Boolean(arquivo));
        });
    }
    const dropLegacy = document.getElementById('comercial-imagem-drop');
    if (dropLegacy) {
        dropLegacy.addEventListener('paste', event => { const item = [...(event.clipboardData?.items || [])].find(entrada => entrada.type.startsWith('image/'));
        if (!item) return;
        const arquivo = item.getAsFile();
        const transferencia = new DataTransfer();
        transferencia.items.add(arquivo);
        if (inputImagemLegacy) inputImagemLegacy.files = transferencia.files;
        mostrarPreviewImagemComercial(arquivo);
        event.preventDefault();
        });
    }
    const modalPreview = document.getElementById('modalPreviewImagemComercial');
    if (modalPreview) {
        modalPreview.addEventListener('click', event => {
            if (event.target === modalPreview) fecharPreviewImagemComercial();
        });
    }
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            const aberto = document.getElementById('modalPreviewImagemComercial')?.classList.contains('active');
            if (aberto) fecharPreviewImagemComercial();
        }
    });
    document.getElementById('agenda-data').value = dataAgendaHoje(); await carregarDestinatariosAgenda(); await carregarAgenda();
    await carregarSolicitacoes(true); await carregarPedidos(true); await carregarKPIs();
    await carregarFornecedores(); await carregarMRP(); await carregarRotas(); 
    const campoItem = document.getElementById('item');
    if (campoItem) { campoItem.addEventListener('input', event => { document.getElementById('item-search-clear')?.classList.toggle('visible', event.target.value.length > 0); pesquisarItens(event.target.value); }); campoItem.addEventListener('keydown', navegarSugestoesItens); }
    document.getElementById('item-search-clear')?.addEventListener('click', () => { const campo = document.getElementById('item'); if (campo) { campo.value = ''; campo.focus(); } document.getElementById('item-search-clear')?.classList.remove('visible'); fecharSugestoesItens(); });
    const campoMrp = document.getElementById('pedido_mrp_nome_input');
    if (campoMrp) { campoMrp.addEventListener('input', event => { document.getElementById('mrp-search-clear').classList.toggle('visible', event.target.value.length > 0); pesquisarMateriaisMRP(event.target.value); }); campoMrp.addEventListener('keydown', navegarSugestoesMRP); }
    const campoProdutoPedidoMRP = document.getElementById('pedido_mrp_produto_input');
    if (campoProdutoPedidoMRP) campoProdutoPedidoMRP.addEventListener('input', event => { document.getElementById('pedido_mrp_material_id').value = ''; pesquisarProdutoPedidoMRP(event.target.value); });
    document.getElementById('pedido_mrp_quantidade')?.addEventListener('input', calcularConsumoPedidoMRP);
    document.getElementById('mrp-search-clear')?.addEventListener('click', () => { const campo = document.getElementById('pedido_mrp_nome_input'); campo.value = ''; campo.focus(); document.getElementById('mrp-search-clear').classList.remove('visible'); fecharSugestoesMRP(); });
    configurarBuscaItemMRP('novo_mrp_item_busca', 'novo_mrp_item_id', 'novo-mrp-item-suggestions', 'novo_mrp_nome');
    configurarBuscaItemMRP('edit_mrp_item_busca', 'edit_mrp_item_id', 'edit-mrp-item-suggestions', 'edit_mrp_nome');
    document.getElementById('dashboard-preco-search')?.addEventListener('input', pesquisarPrecoDashboard);
    const campoPOItem = document.getElementById('novo_po_item');
    const campoPOFornecedor = document.getElementById('novo_po_fornecedor');
    if (campoPOItem) { campoPOItem.addEventListener('input', event => pesquisarItemPO(event.target.value)); campoPOItem.addEventListener('keydown', event => navegarSugestoesPO(event, 'item')); }
    if (campoPOFornecedor) { campoPOFornecedor.addEventListener('input', event => pesquisarFornecedorPO(event.target.value)); campoPOFornecedor.addEventListener('keydown', event => navegarSugestoesPO(event, 'fornecedor')); }
    const campoCompraFornecedor = document.getElementById('compra_mrp_fornecedor');
    if (campoCompraFornecedor) campoCompraFornecedor.addEventListener('input', event => pesquisarFornecedorCompraMRP(event.target.value));
    document.addEventListener('click', event => { if (!event.target.closest('.item-search')) { fecharSugestoesItens(); fecharSugestoesMRP(); fecharSugestoesFornecedorTabela(); } if (!event.target.closest('.precos-search-wrap')) { ['precos-material-suggestions', 'dashboard-preco-suggestions'].forEach(id => { const lista = document.getElementById(id); if (lista) { lista.classList.remove('visible'); lista.innerHTML = ''; } }); } if (!event.target.closest('.preco-autocomplete')) fecharSugestoesPreco(); if (!event.target.closest('.cotacao-fornecedor-autocomplete')) fecharSugestoesFornecedoresCotacao(); if (!event.target.closest('.po-autocomplete')) fecharSugestoesPO(); });
};

let confirmacaoPendente = null;
function confirmarAcao(mensagem) {
    return new Promise(resolve => {
        confirmacaoPendente = resolve;
        document.getElementById('confirmacao-mensagem').textContent = mensagem;
        document.getElementById('modalConfirmacao').classList.add('active');
        document.querySelector('#modalConfirmacao .btn:not(.btn-outline)')?.focus();
    });
}
function resolverConfirmacao(confirmada) {
    document.getElementById('modalConfirmacao').classList.remove('active');
    if (confirmacaoPendente) confirmacaoPendente(confirmada);
    confirmacaoPendente = null;
}

function abrirEnvioAgenda(id) {
    const tarefa = tarefasAgenda.find(item => item.id === id);
    const lista = document.getElementById('envio-agenda-usuarios');
    if (!tarefa || !lista) return;
    document.getElementById('envio-agenda-id').value = id;
    document.getElementById('envio-agenda-observacao').value = tarefa.observacao || '';
    const atuais = new Set((tarefa.destinatarios || []).map(usuario => usuario.id));
    lista.innerHTML = usuariosAgenda.map(usuario => `<label class="agenda-destinatario"><input type="checkbox" value="${usuario.id}" ${atuais.has(usuario.id) ? 'checked' : ''}><span>${escapeHTML(usuario.nome)}<small>${escapeHTML(usuario.email)}</small></span></label>`).join('') || '<span>Nenhum outro usuário disponível.</span>';
    document.getElementById('modalEnvioAgenda').classList.add('active');
}

function fecharEnvioAgenda() { document.getElementById('modalEnvioAgenda')?.classList.remove('active'); }

async function salvarEnvioAgenda(event) {
    event.preventDefault();
    const id = document.getElementById('envio-agenda-id').value;
    const destinatarios = [...document.querySelectorAll('#envio-agenda-usuarios input:checked')].map(campo => Number(campo.value));
    const observacao = document.getElementById('envio-agenda-observacao').value.trim();
    if (!destinatarios.length) { alert('Selecione pelo menos um destinatário.'); return; }
    try {
        const resposta = await fetch(`/api/v1/agenda/${id}/enviar`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({destinatarios, observacao}) });
        const texto = await resposta.text();
        let resultado = {};
        try { resultado = texto ? JSON.parse(texto) : {}; } catch (erroParse) { resultado = { erro: `Servidor respondeu HTTP ${resposta.status}. Reinicie o sistema e tente novamente.` }; }
        if (!resposta.ok) { alert(resultado.erro || 'Não foi possível enviar a anotação.'); return; }
        fecharEnvioAgenda();
        await carregarAgenda();
        mostrarAviso('Anotação enviada com sucesso.', 'success');
    } catch (erro) { console.error(erro); alert('Não foi possível conectar ao servidor.'); }
}

async function abrirCartaoMensagemAgenda(id) {
    try {
        const resposta = await fetch(`/api/v1/agenda/${id}`, { cache: 'no-store' });
        if (!resposta.ok) throw new Error('Mensagem não disponível');
        const tarefa = await resposta.json();
        document.getElementById('agenda-cartao-titulo').textContent = tarefa.titulo;
        document.getElementById('agenda-cartao-info').innerHTML = `<strong>Responsável</strong><span>${escapeHTML(tarefa.criador_nome)}</span><strong>Data</strong><span>${escapeHTML(tarefa.data)}</span><strong>Destinatários</strong><span>${escapeHTML((tarefa.destinatarios || []).map(usuario => usuario.nome).join(', ') || 'Somente remetente')}</span>`;
        document.getElementById('agenda-cartao-comentarios').innerHTML = tarefa.comentarios?.length ? tarefa.comentarios.map(comentario => `<p>${escapeHTML(comentario)}</p>`).join('') : '<p>Nenhum comentário adicional.</p>';
        document.getElementById('agenda-cartao-rastreabilidade').innerHTML = tarefa.rastreabilidade.map(evento => `<div><strong>${escapeHTML(evento.etapa)}</strong><time>${escapeHTML(evento.data)}</time><span>${escapeHTML(evento.detalhe)}</span></div>`).join('');
        document.getElementById('modalCartaoMensagemAgenda').classList.add('active');
    } catch (erro) { alert('Não foi possível abrir a mensagem.'); }
}

function fecharCartaoMensagemAgenda() { document.getElementById('modalCartaoMensagemAgenda')?.classList.remove('active'); }