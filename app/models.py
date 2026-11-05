from app.extensions import db
from datetime import datetime, timedelta
from decimal import Decimal
import json
import re
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash

USUARIO_ADMIN_PROTEGIDO = 'pedro@pcp.com'

PAGINAS_SISTEMA = (
    ('dashboard', 'Dashboard'),
    ('solicitacoes', 'Solicitações de Compra'),
    ('comercial', 'Comercial'),
    ('itens', 'Cadastro de Itens'),
    ('pedidos', 'Pedidos (PO)'),
    ('fornecedores', 'Fornecedores'),
    ('mrp', 'Planejamento MRP'),
    ('rotas', 'Rotas do Motorista'),
    ('precos', 'Formação de Preços'),
    ('usuarios', 'Gerenciar Usuários')
)

class NivelAcesso(db.Model):
    __tablename__ = 'nivel_acesso'
    id = db.Column(db.Integer, primary_key=True)
    nome = db.Column(db.String(50), unique=True, nullable=False)
    permissoes = db.Column(db.Text, nullable=False, default='[]')

    def paginas(self):
        try:
            paginas = json.loads(self.permissoes or '[]')
        except (TypeError, ValueError):
            paginas = []
        return paginas if isinstance(paginas, list) else []

    def to_dict(self):
        return {'id': self.id, 'nome': self.nome, 'permissoes': self.paginas()}

class Usuario(db.Model, UserMixin):
    __tablename__ = 'usuario'
    id = db.Column(db.Integer, primary_key=True)
    nome = db.Column(db.String(150), nullable=False)
    email = db.Column(db.String(150), unique=True, nullable=False)
    senha_hash = db.Column(db.String(255), nullable=False)
    perfil = db.Column(db.String(50), default='solicitante')
    data_criacao = db.Column(db.DateTime, default=datetime.utcnow)
    email_confirmado = db.Column(db.Boolean, default=False, nullable=False)
    email_confirmacao_token_hash = db.Column(db.String(64), nullable=True)
    email_confirmacao_expira_em = db.Column(db.DateTime, nullable=True)

    def set_senha(self, senha):
        self.senha_hash = generate_password_hash(senha)

    def verificar_senha(self, senha):
        return check_password_hash(self.senha_hash, senha)

    def to_dict(self):
        return {
            "id": self.id,
            "nome": self.nome,
            "email": self.email,
            "perfil": self.perfil,
            "email_confirmado": self.email_confirmado
        }

agenda_tarefa_usuario = db.Table(
    'agenda_tarefa_usuario',
    db.Column('tarefa_id', db.Integer, db.ForeignKey('agenda_tarefa.id'), primary_key=True),
    db.Column('usuario_id', db.Integer, db.ForeignKey('usuario.id'), primary_key=True)
)

class AgendaTarefa(db.Model):
    __tablename__ = 'agenda_tarefa'
    id = db.Column(db.Integer, primary_key=True)
    usuario_id = db.Column(db.Integer, db.ForeignKey('usuario.id'), nullable=False, index=True)
    titulo = db.Column(db.String(255), nullable=False)
    observacao = db.Column(db.Text, default='')
    data = db.Column(db.String(10), nullable=False, index=True)
    concluida = db.Column(db.Boolean, default=False, nullable=False)
    ordem = db.Column(db.Integer, default=0, nullable=False)
    data_criacao = db.Column(db.DateTime, default=datetime.utcnow)
    criador = db.relationship('Usuario', foreign_keys=[usuario_id], backref='anotacoes_criadas')
    destinatarios = db.relationship('Usuario', secondary='agenda_tarefa_usuario', backref='anotacoes_compartilhadas')

    def to_dict(self):
        return {
            'id': self.id, 'titulo': self.titulo, 'observacao': self.observacao or '',
            'data': self.data, 'concluida': self.concluida, 'ordem': self.ordem,
            'criador_id': self.usuario_id, 'criador_nome': self.criador.nome if self.criador else '',
            'destinatarios': [{'id': usuario.id, 'nome': usuario.nome} for usuario in self.destinatarios]
        }

class FormacaoPreco(db.Model):
    __tablename__ = 'formacao_preco'
    id = db.Column(db.Integer, primary_key=True)
    material_nome = db.Column(db.String(150), nullable=False)
    fornecedor_servico = db.Column(db.String(100), nullable=True)
    data_recebimento = db.Column(db.String(50), nullable=True)
    nfe = db.Column(db.String(50), nullable=True)
    observacao = db.Column(db.Text, nullable=True, default='')
    valor_fio_kg = db.Column(db.Float, nullable=True)
    valor_servico_kg = db.Column(db.Float, nullable=True)
    frete_kg = db.Column(db.Float, nullable=True)
    peso_bruto = db.Column(db.Float, nullable=True)
    peso_liquido = db.Column(db.Float, nullable=True)
    perda_kg = db.Column(db.Float, nullable=True)
    perda_percentual = db.Column(db.Float, nullable=True)
    preco_final_kg = db.Column(db.Float, nullable=True)

    def to_dict(self):
        return {campo: getattr(self, campo) for campo in (
            'id', 'material_nome', 'fornecedor_servico', 'data_recebimento', 'nfe', 'observacao',
            'valor_fio_kg', 'valor_servico_kg', 'frete_kg', 'peso_bruto', 'peso_liquido',
            'perda_kg', 'perda_percentual', 'preco_final_kg'
        )} | {'fios': [fio.to_dict() for fio in self.fios]}

class FormacaoPrecoFio(db.Model):
    __tablename__ = 'formacao_preco_fio'
    id = db.Column(db.Integer, primary_key=True)
    formacao_preco_id = db.Column(db.Integer, db.ForeignKey('formacao_preco.id'), nullable=False)
    nome = db.Column(db.String(150), nullable=False)
    valor_kg = db.Column(db.Float, nullable=False)
    formacao_preco = db.relationship('FormacaoPreco', back_populates='fios')

    def to_dict(self):
        return {'id': self.id, 'nome': self.nome, 'valor_kg': self.valor_kg}

FormacaoPreco.fios = db.relationship(
    'FormacaoPrecoFio', back_populates='formacao_preco',
    cascade='all, delete-orphan', lazy=True
)

class Item(db.Model):
    __tablename__ = 'item'
    id = db.Column(db.Integer, primary_key=True)
    codigo = db.Column(db.String(100), unique=True, nullable=False)
    descricao = db.Column(db.String(255), nullable=False)
    estoque = db.Column(db.Float, default=0.0, nullable=False)
    grupo = db.Column(db.String(150), default='')
    fabricante = db.Column(db.String(150), default='')
    unidade = db.Column(db.String(30), default='UN')
    ultimo_preco = db.Column(db.Numeric(12, 2), nullable=True)
    data_criacao = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "codigo": self.codigo,
            "descricao": self.descricao,
            "estoque": self.estoque,
            "grupo": self.grupo,
            "fabricante": self.fabricante,
            "unidade": self.unidade,
            "ultimo_preco": float(self.ultimo_preco) if self.ultimo_preco is not None else None
        }

class SolicitacaoCompra(db.Model):
    __tablename__ = 'solicitacao_compra'
    id = db.Column(db.Integer, primary_key=True)
    item = db.Column(db.String(150), nullable=False)
    quantidade = db.Column(db.Float, nullable=False)
    itens_detalhados = db.Column(db.Text, default='')
    setor_solicitante = db.Column(db.String(100), nullable=False)
    numero_pedido_sap = db.Column(db.String(50), nullable=True)
    usuario_id = db.Column(db.Integer, db.ForeignKey('usuario.id'), nullable=True, index=True)
    status = db.Column(db.String(50), default='pendente')
    data_solicitacao = db.Column(db.DateTime, default=datetime.utcnow)
    etiquetas = db.Column(db.String(255), default="") 
    cotacoes = db.relationship('Cotacao', backref='solicitacao', lazy=True, cascade="all, delete-orphan")
    pedidos = db.relationship('PedidoCompra', backref='solicitacao', lazy=True, cascade="all, delete-orphan")
    criador = db.relationship('Usuario', backref='solicitacoes_criadas')

    def to_dict(self):
        solicitante = self.criador.nome if self.criador else (self.setor_solicitante or 'Solicitante')
        try:
            itens_detalhados = json.loads(self.itens_detalhados or '[]')
        except (TypeError, ValueError):
            itens_detalhados = []
        itens_formatados = []
        for item_detalhado in itens_detalhados:
            if not isinstance(item_detalhado, dict):
                continue
            item_formatado = dict(item_detalhado)
            cadastro = Item.query.filter(
                db.or_(Item.codigo == item_formatado.get('codigo'), Item.descricao == item_formatado.get('item'))
            ).first()
            item_formatado['codigo'] = item_formatado.get('codigo') or (cadastro.codigo if cadastro else '')
            item_formatado['status'] = item_formatado.get('status') or 'pendente'
            itens_formatados.append(item_formatado)
        return {
            "id": f"SC-{1000 + self.id}", "db_id": self.id, "item": self.item,
            "quantidade": self.quantidade, "setor": solicitante, "solicitante": solicitante,
            "itens_detalhados": itens_formatados,
            "status": self.status, "numero_pedido_sap": self.numero_pedido_sap or "",
            "etiquetas": self.etiquetas, "usuario_id": self.usuario_id,
            "data": self.data_solicitacao.strftime("%d/%m/%Y")
        }

class Cotacao(db.Model):
    __tablename__ = 'cotacao'
    id = db.Column(db.Integer, primary_key=True)
    solicitacao_id = db.Column(db.Integer, db.ForeignKey('solicitacao_compra.id'), nullable=False)
    fornecedor = db.Column(db.String(150), nullable=False)
    valor_unitario = db.Column(db.Numeric(12, 4), nullable=False)
    itens_cotacao = db.Column(db.Text, default='')
    valor_total = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    prazo_entrega = db.Column(db.String(50), nullable=False)
    condicao_pgto = db.Column(db.String(100), nullable=False)
    data_cotacao = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        try:
            itens = json.loads(self.itens_cotacao or '[]')
        except (TypeError, ValueError):
            itens = []
        if not itens:
            quantidade = float(self.solicitacao.quantidade or 0) if self.solicitacao else 0
            itens = [{'item': self.solicitacao.item if self.solicitacao else '', 'quantidade': quantidade,
                      'unidade': 'UN',
                      'valor_unitario_raw': float(self.valor_unitario), 'valor_total_raw': float(self.valor_unitario * Decimal(str(quantidade)))}]
        total = self.valor_total or sum(Decimal(str(item.get('valor_total_raw', 0) or 0)) for item in itens)
        return {
            "id": self.id, "fornecedor": self.fornecedor, "valor_unitario_raw": float(self.valor_unitario),
            "valor_unitario": f"R$ {self.valor_unitario:,.4f}".replace(',', 'X').replace('.', ',').replace('X', '.'),
            "itens": itens,
            "valor_total_raw": float(total),
            "valor_total": f"R$ {total:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.'),
            "prazo_entrega": self.prazo_entrega, "condicao_pgto": self.condicao_pgto
        }

class PedidoCompra(db.Model):
    __tablename__ = 'pedido_compra'
    id = db.Column(db.Integer, primary_key=True)
    solicitacao_id = db.Column(db.Integer, db.ForeignKey('solicitacao_compra.id'), nullable=True)
    item_nome = db.Column(db.String(150), nullable=True)
    quantidade = db.Column(db.Float, nullable=True, default=0.0)
    itens_pedido = db.Column(db.Text, default='')
    fornecedor = db.Column(db.String(150), nullable=False)
    valor_total = db.Column(db.Numeric(12, 2), nullable=False)
    status = db.Column(db.String(50), default='gerado')
    data_emissao = db.Column(db.DateTime, default=datetime.utcnow)
    data_entrega = db.Column(db.DateTime, nullable=True)
    prazo_dias = db.Column(db.Integer, default=7)
    etiquetas = db.Column(db.String(255), default="")

    @staticmethod
    def converter_prazo_dias(prazo, padrao=7):
        """Converte prazos como 1, '10 dias' ou '30 dias úteis' em dias corridos."""
        if prazo is None:
            return padrao
        correspondencia = re.search(r'\d+', str(prazo).strip())
        if not correspondencia:
            return padrao
        return max(0, int(correspondencia.group()))

    def to_dict(self):
        prazo_dias = self.prazo_dias if self.prazo_dias is not None else 7
        data_prevista_dt = self.data_emissao + timedelta(days=prazo_dias)
        data_limite = data_prevista_dt.timestamp()
        is_atrasado = self.status in ['gerado', 'transito', 'aprovado'] and datetime.utcnow().timestamp() > data_limite
        nome_exibicao = self.item_nome if self.item_nome else (self.solicitacao.item if self.solicitacao else "N/A")
        quantidade = self.quantidade
        if quantidade is None or float(quantidade or 0) <= 0:
            quantidade = self.solicitacao.quantidade if self.solicitacao else 0
        quantidade = float(quantidade or 0)
        itens_pedido = self._obter_itens_pedido_legado()

        return {
            "id": f"PO-{500 + self.id}", "db_id": self.id,
            "sc_ref": f"SC-{1000 + self.solicitacao_id}" if self.solicitacao_id else "Compra Direta",
            "item": nome_exibicao,
            "quantidade": quantidade,
            "itens": itens_pedido,
            "fornecedor": self.fornecedor,
            "valor_total": f"R$ {self.valor_total:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.'),
            "status": self.status, "etiquetas": self.etiquetas,
            "data_emissao_iso": self.data_emissao.isoformat() if self.data_emissao else None,
            "data_entrega_iso": self.data_entrega.isoformat() if self.data_entrega else None,
            "data": self.data_emissao.strftime("%d/%m/%Y"), "data_prevista": data_prevista_dt.strftime("%d/%m/%Y"),
            "data_prevista_iso": data_prevista_dt.strftime("%Y-%m-%d"), "prazo_dias": prazo_dias, "atrasado": is_atrasado
        }

    def _obter_itens_pedido_legado(self):
        try:
            itens_salvos = json.loads(self.itens_pedido or '[]')
        except (TypeError, ValueError):
            itens_salvos = []
        solicitacao = self.solicitacao
        if not solicitacao:
            if isinstance(itens_salvos, list) and itens_salvos:
                return itens_salvos
            nome_item = self.item_nome or ''
            nomes = [nome.strip() for nome in nome_item.split(';') if nome.strip()]
            return [{
                'item': nome,
                'quantidade_solicitada': None,
                'quantidade_pedida': self.quantidade if len(nomes) == 1 else None,
                'incluido_no_pedido': True
            } for nome in nomes]

        try:
            itens_solicitados = json.loads(solicitacao.itens_detalhados or '[]')
        except (TypeError, ValueError):
            itens_solicitados = []
        if not isinstance(itens_solicitados, list) or not itens_solicitados:
            nomes = [nome.strip() for nome in (solicitacao.item or '').split(';') if nome.strip()]
            itens_solicitados = [
                {
                    'item': nome,
                    'quantidade': solicitacao.quantidade if len(nomes) == 1 else None
                }
                for nome in nomes
            ]

        solicitados_por_nome = {}
        for item in itens_solicitados:
            if not isinstance(item, dict):
                continue
            nome = str(item.get('item') or '').strip()
            if nome:
                solicitados_por_nome.setdefault(nome.casefold(), []).append(item)

        cotacoes = [
            cotacao for cotacao in solicitacao.cotacoes
            if str(cotacao.fornecedor or '').casefold() == str(self.fornecedor or '').casefold()
            and (
                not self.data_emissao
                or not cotacao.data_cotacao
                or cotacao.data_cotacao <= self.data_emissao
            )
        ]
        cotacao_escolhida = None
        if cotacoes:
            def pontuacao_cotacao(cotacao):
                try:
                    itens_cotados = json.loads(cotacao.itens_cotacao or '[]')
                except (TypeError, ValueError):
                    itens_cotados = []
                correspondencias = sum(
                    1 for item in itens_cotados
                    if isinstance(item, dict)
                    and str(item.get('item') or '').strip().casefold() in solicitados_por_nome
                )
                diferenca_valor = abs(float(cotacao.valor_total or 0) - float(self.valor_total or 0))
                data = cotacao.data_cotacao.timestamp() if cotacao.data_cotacao else 0
                return correspondencias, -diferenca_valor, data

            melhor_cotacao = max(cotacoes, key=pontuacao_cotacao)
            if pontuacao_cotacao(melhor_cotacao)[0] > 0:
                cotacao_escolhida = melhor_cotacao

        try:
            itens_cotados = json.loads(cotacao_escolhida.itens_cotacao or '[]') if cotacao_escolhida else []
        except (TypeError, ValueError):
            itens_cotados = []

        itens_por_nome = {}
        itens_origem = itens_salvos if isinstance(itens_salvos, list) and itens_salvos else itens_cotados
        if itens_origem:
            for item_origem in itens_origem:
                if not isinstance(item_origem, dict) or item_origem.get('incluido_no_pedido') is False:
                    continue
                nome = str(item_origem.get('item') or '').strip()
                if not nome:
                    continue
                quantidade_pedida = item_origem.get('quantidade_pedida')
                if quantidade_pedida is None:
                    quantidade_pedida = item_origem.get('quantidade')
                itens_por_nome.setdefault(nome.casefold(), []).append({
                    'quantidade_pedida': quantidade_pedida,
                    'unidade': item_origem.get('unidade') or 'UN',
                    'valor_unitario': item_origem.get('valor_unitario', item_origem.get('valor_unitario_raw')),
                    'valor_total': item_origem.get('valor_total', item_origem.get('valor_total_raw'))
                })
        elif itens_cotados:
            for item_cotado in itens_cotados:
                if not isinstance(item_cotado, dict):
                    continue
                nome = str(item_cotado.get('item') or '').strip()
                if not nome:
                    continue
                itens_por_nome.setdefault(nome.casefold(), []).append({
                    'quantidade_pedida': item_cotado.get('quantidade'),
                    'unidade': item_cotado.get('unidade') or 'UN',
                    'valor_unitario': item_cotado.get('valor_unitario_raw'),
                    'valor_total': item_cotado.get('valor_total_raw')
                })
        else:
            nomes_pedidos = {
                nome.strip().casefold()
                for nome in (self.item_nome or '').split(';')
                if nome.strip()
            }
            itens_por_nome = {
                nome: [{'quantidade_pedida': None}]
                for nome in nomes_pedidos
            }

        itens_pedido = []
        for item_solicitado in itens_solicitados:
            if not isinstance(item_solicitado, dict):
                continue
            nome = str(item_solicitado.get('item') or '').strip()
            if not nome:
                continue
            encontrados = itens_por_nome.get(nome.casefold(), [])
            item_pedido = encontrados.pop(0) if encontrados else None
            itens_pedido.append({
                'item': nome,
                'quantidade_solicitada': item_solicitado.get('quantidade'),
                'quantidade_pedida': item_pedido.get('quantidade_pedida') if item_pedido else None,
                'incluido_no_pedido': item_pedido is not None,
                'unidade': item_pedido.get('unidade') if item_pedido else None,
                'valor_unitario': item_pedido.get('valor_unitario') if item_pedido else None,
                'valor_total': item_pedido.get('valor_total') if item_pedido else None
            })

        return itens_pedido

class Comentario(db.Model):
    __tablename__ = 'comentario'
    id = db.Column(db.Integer, primary_key=True)
    tipo_ref = db.Column(db.String(10), nullable=False)
    ref_id = db.Column(db.Integer, nullable=False)
    texto = db.Column(db.Text, nullable=False)
    data_criacao = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return { "id": self.id, "texto": self.texto, "data": self.data_criacao.strftime("%d/%m %H:%M") }

class Notificacao(db.Model):
    __tablename__ = 'notificacao'
    id = db.Column(db.Integer, primary_key=True)
    usuario_id = db.Column(db.Integer, db.ForeignKey('usuario.id'), nullable=False, index=True)
    titulo = db.Column(db.String(150), nullable=False)
    mensagem = db.Column(db.String(500), nullable=False)
    tipo = db.Column(db.String(50), default='solicitacao', nullable=False)
    referencia_id = db.Column(db.Integer, nullable=True)
    lida = db.Column(db.Boolean, default=False, nullable=False, index=True)
    data_criacao = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    usuario = db.relationship('Usuario', backref='notificacoes')

    def to_dict(self):
        return {
            'id': self.id, 'titulo': self.titulo, 'mensagem': self.mensagem,
            'tipo': self.tipo, 'referencia_id': self.referencia_id,
            'lida': self.lida, 'data': self.data_criacao.strftime('%d/%m %H:%M')
        }

class Fornecedor(db.Model):
    __tablename__ = 'fornecedor'
    id = db.Column(db.Integer, primary_key=True)
    cnpj = db.Column(db.String(20), unique=True, nullable=False)
    razao_social = db.Column(db.String(150), nullable=False)
    nome_fantasia = db.Column(db.String(150), default='')
    codigo = db.Column(db.String(50), unique=True, nullable=True)
    uf = db.Column(db.String(2), default='')
    cidade = db.Column(db.String(100), default='')
    ativo = db.Column(db.Boolean, default=True, nullable=False)
    categoria = db.Column(db.String(100), nullable=False)
    avaliacao = db.Column(db.String(50), default='⭐⭐⭐⭐⭐')

    def to_dict(self):
        return {
            "id": self.id, "cnpj": self.cnpj, "razao_social": self.razao_social,
            "nome_fantasia": self.nome_fantasia or "", "codigo": self.codigo or "",
            "uf": self.uf or "", "cidade": self.cidade or "", "ativo": self.ativo,
            "categoria": self.categoria, "avaliacao": self.avaliacao
        }

class MaterialPlanejamento(db.Model):
    __tablename__ = 'material_planejamento'
    id = db.Column(db.Integer, primary_key=True)
    item_id = db.Column(db.Integer, db.ForeignKey('item.id'), nullable=True, index=True)
    item = db.relationship('Item', backref=db.backref('materiais_planejamento', lazy=True))
    nome = db.Column(db.String(150), nullable=False)
    produto_nome = db.Column(db.String(150), nullable=True)
    cliente = db.Column(db.String(150), nullable=True)
    material_utilizado = db.Column(db.String(150), nullable=True)
    estoque_atual = db.Column(db.Float, default=0.0)
    demanda_pecas = db.Column(db.Float, default=0.0)
    consumo_por_peca = db.Column(db.Float, default=0.0)
    comprado_recebido = db.Column(db.Float, default=0.0)
    eh_demillus = db.Column(db.Boolean, default=False, nullable=False)
    oculto = db.Column(db.Boolean, default=False)
    planilha_aba = db.Column(db.String(150), nullable=True)
    planilha_nome = db.Column(db.String(255), nullable=True)
    historico_planilha = db.Column(db.Text, nullable=True)

    def to_dict(self):
        planejado = self.demanda_pecas * self.consumo_por_peca
        saldo = (self.estoque_atual + self.comprado_recebido) - planejado
        status = "Estoque OK" if saldo >= 0 else "Comprar"
        return {
            "id": self.id, "nome": self.nome, "produto_nome": self.produto_nome or self.nome,
            "cliente": self.cliente or '', "material_utilizado": self.material_utilizado or self.nome,
            "item_id": self.item_id,
            "item_referencia": self.item.to_dict() if self.item else None,
            "estoque_atual": round(self.estoque_atual, 2),
            "demanda_pecas": round(self.demanda_pecas, 2), "consumo_por_peca": round(self.consumo_por_peca, 4),
            "planejado_total": round(planejado, 2), "comprado_recebido": round(self.comprado_recebido, 2),
            "saldo": round(saldo, 2), "status": status, "sugestao_compra": round(abs(saldo), 2) if saldo < 0 else 0,
            "eh_demillus": self.eh_demillus,
            "oculto": self.oculto,
            "planilha_aba": self.planilha_aba or '',
            "planilha_nome": self.planilha_nome or '',
            "historico_planilha": json.loads(self.historico_planilha or '[]')
                if self.historico_planilha else []
        }

class CompraMRP(db.Model):
    __tablename__ = 'compra_mrp'
    id = db.Column(db.Integer, primary_key=True)
    material_id = db.Column(db.Integer, db.ForeignKey('material_planejamento.id'), nullable=False, index=True)
    data_compra = db.Column(db.String(10), nullable=False)
    quantidade = db.Column(db.Float, nullable=False)
    fornecedor = db.Column(db.String(150), nullable=False)
    data_recebimento = db.Column(db.String(10), nullable=True)
    quantidade_recebida = db.Column(db.Float, default=0.0, nullable=False)
    data_criacao = db.Column(db.DateTime, default=datetime.utcnow)
    material = db.relationship('MaterialPlanejamento', backref=db.backref('compras_mrp', lazy=True, cascade='all, delete-orphan'))
    pedidos = db.relationship('PedidoMRP', secondary='compra_pedido_mrp', back_populates='compras')

    def to_dict(self):
        return {
            'id': self.id,
            'data_compra': self.data_compra,
            'quantidade': round(self.quantidade, 2),
            'fornecedor': self.fornecedor,
            'data_recebimento': self.data_recebimento,
            'quantidade_recebida': round(self.quantidade_recebida, 2),
            'saldo_fornecedor': round(self.quantidade - self.quantidade_recebida, 2),
            'pedido_ids': [pedido.id for pedido in self.pedidos]
        }


compra_pedido_mrp = db.Table(
    'compra_pedido_mrp',
    db.Column('compra_id', db.Integer, db.ForeignKey('compra_mrp.id'), primary_key=True),
    db.Column('pedido_id', db.Integer, db.ForeignKey('pedido_mrp.id'), primary_key=True)
)

class PedidoMRP(db.Model):
    __tablename__ = 'pedido_mrp'
    id = db.Column(db.Integer, primary_key=True)
    material_id = db.Column(db.Integer, db.ForeignKey('material_planejamento.id'), nullable=False, index=True)
    cliente = db.Column(db.String(150), nullable=False)
    produto = db.Column(db.String(150), nullable=False)
    quantidade_pecas = db.Column(db.Float, nullable=False)
    consumo_por_peca = db.Column(db.Float, nullable=False)
    consumo_total = db.Column(db.Float, nullable=False)
    data_criacao = db.Column(db.DateTime, default=datetime.utcnow)
    material = db.relationship('MaterialPlanejamento', backref=db.backref('pedidos_mrp', lazy=True, cascade='all, delete-orphan'))
    compras = db.relationship('CompraMRP', secondary='compra_pedido_mrp', back_populates='pedidos')

    def to_dict(self):
        return {
            'id': self.id, 'material_id': self.material_id, 'cliente': self.cliente,
            'produto': self.produto, 'quantidade_pecas': round(self.quantidade_pecas, 2),
            'consumo_por_peca': round(self.consumo_por_peca, 4), 'consumo_total': round(self.consumo_total, 2),
            'data_pedido': self.data_criacao.strftime('%d/%m/%Y') if self.data_criacao else '',
            'compra_ids': [compra.id for compra in self.compras]
        }

class PedidoComercial(db.Model):
    __tablename__ = 'pedido_comercial'
    id = db.Column(db.Integer, primary_key=True)
    cliente = db.Column(db.String(150), nullable=False)
    data_pedido = db.Column(db.Date, nullable=False)
    pedido_sap = db.Column(db.String(50), nullable=False)
    incluido_no_sap = db.Column(db.Boolean, default=False, nullable=False)
    valor_total = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    observacoes = db.Column(db.Text, default='')
    resumo = db.Column(db.Text, default='')
    data_criacao = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    itens = db.relationship('PedidoComercialItem', backref='pedido', lazy=True, cascade='all, delete-orphan')

    @property
    def produto_resumido(self):
        if not self.itens:
            return ''
        return ' • '.join(f"{item.produto} ({item.quantidade})" for item in self.itens)

    def to_dict(self):
        itens = [item.to_dict() for item in self.itens]
        total_quantidade = sum(float(item.get('quantidade', 0) or 0) for item in itens) if itens else 0.0
        total_valor = sum(Decimal(str(item.get('valor', 0) or 0)) for item in itens) if itens else Decimal('0')
        if total_valor == Decimal('0') and self.valor_total:
            total_valor = Decimal(str(self.valor_total))
        valor_total_fmt = f"R$ {total_valor:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')
        return {
            'id': self.id,
            'cliente': self.cliente,
            'data_pedido': self.data_pedido.strftime('%d/%m/%Y'),
            'pedido_sap': self.pedido_sap,
            'incluido_no_sap': self.incluido_no_sap,
            'valor_total': float(total_valor),
            'valor_total_formatado': valor_total_fmt,
            'observacoes': self.observacoes or '',
            'resumo': self.resumo or '',
            'produto': self.itens[0].produto if self.itens else '',
            'quantidade': total_quantidade,
            'imagem_url': f'/api/v1/comercial/imagens/{self.itens[0].imagem_filename}' if self.itens and self.itens[0].imagem_filename else '',
            'itens': itens
        }

class PedidoComercialItem(db.Model):
    __tablename__ = 'pedido_comercial_item'
    id = db.Column(db.Integer, primary_key=True)
    pedido_id = db.Column(db.Integer, db.ForeignKey('pedido_comercial.id'), nullable=False)
    produto = db.Column(db.String(150), nullable=False)
    quantidade = db.Column(db.Float, nullable=False)
    valor = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    observacao = db.Column(db.Text, default='')
    imagem_filename = db.Column(db.String(255), nullable=True)
    data_criacao = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    def to_dict(self):
        valor = Decimal(str(self.valor or 0))
        return {
            'id': self.id,
            'pedido_id': self.pedido_id,
            'produto': self.produto,
            'quantidade': self.quantidade,
            'valor': float(valor),
            'valor_formatado': f"R$ {valor:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.'),
            'observacao': self.observacao or '',
            'imagem_url': f'/api/v1/comercial/imagens/{self.imagem_filename}' if self.imagem_filename else ''
        }

class RotaMotorista(db.Model):
    __tablename__ = 'rota_motorista'
    id = db.Column(db.Integer, primary_key=True)
    data_prevista = db.Column(db.String(20), nullable=False)
    motorista = db.Column(db.String(100), nullable=False)
    destino_fornecedor = db.Column(db.String(150), nullable=False)
    endereco = db.Column(db.String(255), default="")
    localizacao_mapa = db.Column(db.String(500), default="")
    po_ref = db.Column(db.String(50), default="")
    status = db.Column(db.String(50), default='pendente')
    observacoes = db.Column(db.Text, default="")
    
    def to_dict(self):
        return {
            "id": self.id, "data_prevista": self.data_prevista, "motorista": self.motorista,
            "destino_fornecedor": self.destino_fornecedor, "endereco": self.endereco or "",
            "localizacao_mapa": self.localizacao_mapa or "", "po_ref": self.po_ref,
            "status": self.status, "observacoes": self.observacoes
        }

class Anexo(db.Model):
    __tablename__ = 'anexo'
    id = db.Column(db.Integer, primary_key=True)
    tipo_ref = db.Column(db.String(10), nullable=False)
    ref_id = db.Column(db.Integer, nullable=False)
    nome_arquivo = db.Column(db.String(255), nullable=False) 
    caminho_arquivo = db.Column(db.String(500), nullable=False) 
    data_upload = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id, "nome_arquivo": self.nome_arquivo,
            "data": self.data_upload.strftime("%d/%m %H:%M"), "url": f"/api/v1/anexos/download/{self.id}"
        }