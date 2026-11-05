import os
import json
import secrets
from datetime import datetime
from flask import Flask, render_template
from flask_login import login_required
from sqlalchemy import inspect, text
from app.extensions import db, login_manager
from app.api.compras_api import api_bp
from app.auth import auth_bp
import logging
import re
import unicodedata
import pandas as pd
from openpyxl import load_workbook
from app.models import Usuario, NivelAcesso, FormacaoPreco, SolicitacaoCompra, Comentario, PAGINAS_SISTEMA, USUARIO_ADMIN_PROTEGIDO

app = Flask(__name__, template_folder='templates', static_folder='static')

basedir = os.path.abspath(os.path.dirname(os.path.dirname(__file__)))
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(basedir, 'compras.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY') or secrets.token_hex(32)

db.init_app(app)
login_manager.init_app(app)

@login_manager.user_loader
def load_user(user_id):
    return Usuario.query.get(int(user_id))

app.register_blueprint(api_bp)
app.register_blueprint(auth_bp)

@app.route('/')
@login_required
def index():
    return render_template('index.html')

def _normalizar_planilha(valor):
    texto = '' if pd.isna(valor) else str(valor).strip()
    texto = ''.join(c for c in unicodedata.normalize('NFKD', texto) if not unicodedata.combining(c)).upper()
    return ' '.join(texto.replace(':', '').split())

def _numero_planilha(valor):
    if valor is None or pd.isna(valor) or str(valor).strip() == '':
        return None
    if isinstance(valor, (int, float)):
        return float(valor)
    texto = str(valor).replace('R$', '').replace('%', '').replace(' ', '').strip()
    if ',' in texto:
        texto = texto.replace('.', '').replace(',', '.')
    try:
        return float(re.sub(r'[^0-9.-]', '', texto))
    except ValueError:
        return None

def _texto_planilha(valor):
    if valor is None or pd.isna(valor):
        return ''
    if isinstance(valor, (pd.Timestamp, datetime)):
        return valor.strftime('%d/%m/%Y')
    return str(valor).strip()

def _valor_por_rotulo(linhas, rotulos):
    for linha in linhas:
        for indice, celula in enumerate(linha or []):
            if _normalizar_planilha(celula) in rotulos:
                for valor in linha[indice + 1:]:
                    if valor is not None and str(valor).strip():
                        return valor
                break
    return None

def _linha_por_rotulo(linhas, rotulos):
    for linha in linhas:
        if linha and _normalizar_planilha(linha[0]) in rotulos:
            return linha
    return []

def importar_formacao_precos():
    caminho = os.path.join(basedir, 'PREÇO FINAL (CORES E TONS E LIPLIP) (1).xlsx')
    if not os.path.exists(caminho):
        return
    if FormacaoPreco.query.count() > 0:
        return
    try:
        arquivo = pd.ExcelFile(caminho)
        arquivo_calculado = load_workbook(caminho, data_only=True)
        registros = []
        for aba in arquivo.sheet_names:
            linhas = pd.read_excel(arquivo, sheet_name=aba, header=None).where(lambda tabela: pd.notna(tabela), None).values.tolist()
            linhas_calculadas = [[celula.value for celula in linha] for linha in arquivo_calculado[aba].iter_rows()]
            cabecalho_indice = next((i for i, linha in enumerate(linhas) if 'DATA RECEBIMENTO' in [_normalizar_planilha(v) for v in linha]), None)
            material = aba.strip()
            fornecedor = 'Lip Lip' if 'LIP' in _normalizar_planilha(aba) else ('C&T' if 'C&T' in aba.upper() or 'CORES' in _normalizar_planilha(aba) else aba.strip())
            if cabecalho_indice is not None:
                cabecalho = [_normalizar_planilha(v) for v in linhas[cabecalho_indice]]
                for linha in linhas[cabecalho_indice + 1:]:
                    if not any(v is not None and str(v).strip() for v in linha):
                        continue
                    valores = {nome: linha[indice] if indice < len(linha) else None for indice, nome in enumerate(cabecalho)}
                    perda_percentual = _numero_planilha(valores.get('%'))
                    if perda_percentual is not None and perda_percentual <= 1:
                        perda_percentual *= 100
                    registros.append(FormacaoPreco(material_nome=material, fornecedor_servico=fornecedor, data_recebimento=_texto_planilha(valores.get('DATA RECEBIMENTO')), nfe=_texto_planilha(valores.get('NFE')), valor_fio_kg=_numero_planilha(valores.get('VALOR FIO')), valor_servico_kg=_numero_planilha(valores.get('VLR SERVICO') or valores.get('SERVICO')), frete_kg=_numero_planilha(valores.get('FRETE KG')), peso_bruto=_numero_planilha(valores.get('PESO BRUTO')), peso_liquido=_numero_planilha(valores.get('PESO LIQUIDO')), perda_kg=_numero_planilha(valores.get('PERDA - KG')), perda_percentual=perda_percentual, preco_final_kg=_numero_planilha(valores.get('PRECO POR KG'))))
            else:
                linha_fio = _linha_por_rotulo(linhas, {'VALOR FIO ALG.', 'VALOR FIO'})
                linha_fio_poli = _linha_por_rotulo(linhas, {'VALOR FIO POLI.'})
                linha_servico = _linha_por_rotulo(linhas, {'SERVICO'})
                linha_frete = _linha_por_rotulo(linhas, {'FRETE FIO', 'FRETE'})
                peso_bruto = sum(_numero_planilha(linha[1] if len(linha) > 1 else None) or 0 for linha in (linha_fio, linha_fio_poli)) or None
                peso_liquido = _numero_planilha(_valor_por_rotulo(linhas_calculadas, {'PESO LIQUIDO'}))
                perda_kg = _numero_planilha(_valor_por_rotulo(linhas_calculadas, {'PERDA KG', 'PERDA'}))
                perda_percentual = perda_kg / peso_bruto * 100 if perda_kg is not None and peso_bruto else None
                registros.append(FormacaoPreco(material_nome=material, fornecedor_servico=fornecedor, data_recebimento=_texto_planilha(linhas[0][0] if linhas and linhas[0] else ''), nfe=_texto_planilha(_valor_por_rotulo(linhas, {'NF', 'NFE'})), valor_fio_kg=_numero_planilha(linha_fio[2] if len(linha_fio) > 2 else None), valor_servico_kg=_numero_planilha(linha_servico[2] if len(linha_servico) > 2 else None), frete_kg=_numero_planilha(linha_frete[2] if len(linha_frete) > 2 else None), peso_bruto=peso_bruto, peso_liquido=peso_liquido, perda_kg=perda_kg, perda_percentual=perda_percentual, preco_final_kg=_numero_planilha(_valor_por_rotulo(linhas_calculadas, {'PRECO FINAL', 'PRECO POR KG'}))))
        db.session.query(FormacaoPreco).delete()
        db.session.add_all(registros)
        db.session.commit()
    except Exception as erro:
        db.session.rollback()
        logging.getLogger(__name__).warning('Falha ao importar formação de preços: %s', erro)

# Criação automática do usuário administrador na inicialização
with app.app_context():
    db.create_all()
    niveis_padrao = {
        'solicitante': ['dashboard', 'solicitacoes'],
        'estoque': ['dashboard', 'solicitacoes', 'pedidos'],
        'comercial': ['dashboard', 'comercial'],
        'comprador': ['dashboard', 'solicitacoes', 'itens', 'pedidos', 'fornecedores', 'rotas', 'precos'],
        'gerente': ['dashboard', 'solicitacoes', 'itens', 'pedidos', 'fornecedores', 'rotas', 'usuarios'],
        'admin': [pagina[0] for pagina in PAGINAS_SISTEMA]
    }
    for nome, permissoes in niveis_padrao.items():
        if not NivelAcesso.query.filter_by(nome=nome).first():
            db.session.add(NivelAcesso(nome=nome, permissoes=json.dumps(permissoes)))
    db.session.commit()
    colunas_solicitacao = db.session.execute(text('PRAGMA table_info(solicitacao_compra)')).fetchall()
    if not any(coluna[1] == 'itens_detalhados' for coluna in colunas_solicitacao):
        db.session.execute(text("ALTER TABLE solicitacao_compra ADD COLUMN itens_detalhados TEXT DEFAULT ''"))
        db.session.commit()
    colunas_formacao_preco = db.session.execute(text('PRAGMA table_info(formacao_preco)')).fetchall()
    if not any(coluna[1] == 'observacao' for coluna in colunas_formacao_preco):
        db.session.execute(text("ALTER TABLE formacao_preco ADD COLUMN observacao TEXT DEFAULT ''"))
        db.session.commit()
    colunas_cotacao = db.session.execute(text('PRAGMA table_info(cotacao)')).fetchall()
    if not any(coluna[1] == 'itens_cotacao' for coluna in colunas_cotacao):
        db.session.execute(text("ALTER TABLE cotacao ADD COLUMN itens_cotacao TEXT DEFAULT ''"))
    if not any(coluna[1] == 'valor_total' for coluna in colunas_cotacao):
        db.session.execute(text("ALTER TABLE cotacao ADD COLUMN valor_total NUMERIC(12, 2) DEFAULT 0"))
    tipo_valor_unitario = next((coluna[2] for coluna in colunas_cotacao if coluna[1] == 'valor_unitario'), '')
    if tipo_valor_unitario.replace(' ', '').upper() != 'NUMERIC(12,4)':
        db.session.execute(text('ALTER TABLE cotacao RENAME TO cotacao_precisao_antiga'))
        db.session.execute(text('''
            CREATE TABLE cotacao (
                id INTEGER NOT NULL PRIMARY KEY,
                solicitacao_id INTEGER NOT NULL,
                fornecedor VARCHAR(150) NOT NULL,
                valor_unitario NUMERIC(12, 4) NOT NULL,
                prazo_entrega VARCHAR(50) NOT NULL,
                condicao_pgto VARCHAR(100) NOT NULL,
                data_cotacao DATETIME,
                itens_cotacao TEXT DEFAULT '',
                valor_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
                FOREIGN KEY(solicitacao_id) REFERENCES solicitacao_compra (id)
            )
        '''))
        db.session.execute(text('''
            INSERT INTO cotacao (
                id, solicitacao_id, fornecedor, valor_unitario, prazo_entrega,
                condicao_pgto, data_cotacao, itens_cotacao, valor_total
            )
            SELECT id, solicitacao_id, fornecedor, valor_unitario, prazo_entrega,
                   condicao_pgto, data_cotacao, itens_cotacao, valor_total
            FROM cotacao_precisao_antiga
        '''))
        db.session.execute(text('DROP TABLE cotacao_precisao_antiga'))
    db.session.commit()
    indices_compra_pedido = db.session.execute(text('PRAGMA index_list(compra_pedido_mrp)')).fetchall()
    indice_unico_por_pedido = False
    for indice in indices_compra_pedido:
        if not indice[2]:
            continue
        colunas_indice = db.session.execute(text(f'PRAGMA index_info("{indice[1]}")')).fetchall()
        if [coluna[2] for coluna in colunas_indice] == ['pedido_id']:
            indice_unico_por_pedido = True
            break
    if indice_unico_por_pedido:
        with db.engine.begin() as conexao:
            conexao.exec_driver_sql('ALTER TABLE compra_pedido_mrp RENAME TO compra_pedido_mrp_antiga')
            conexao.exec_driver_sql('''
                CREATE TABLE compra_pedido_mrp (
                    compra_id INTEGER NOT NULL,
                    pedido_id INTEGER NOT NULL,
                    PRIMARY KEY (compra_id, pedido_id),
                    FOREIGN KEY(compra_id) REFERENCES compra_mrp (id),
                    FOREIGN KEY(pedido_id) REFERENCES pedido_mrp (id)
                )
            ''')
            conexao.exec_driver_sql('INSERT INTO compra_pedido_mrp (compra_id, pedido_id) SELECT compra_id, pedido_id FROM compra_pedido_mrp_antiga')
            conexao.exec_driver_sql('DROP TABLE compra_pedido_mrp_antiga')
    colunas_sc = {coluna['name'] for coluna in inspect(db.engine).get_columns('solicitacao_compra')}
    if 'usuario_id' not in colunas_sc:
        with db.engine.begin() as conexao:
            conexao.exec_driver_sql('ALTER TABLE solicitacao_compra ADD COLUMN usuario_id INTEGER REFERENCES usuario(id)')
    if 'numero_pedido_sap' not in colunas_sc:
        with db.engine.begin() as conexao:
            conexao.exec_driver_sql('ALTER TABLE solicitacao_compra ADD COLUMN numero_pedido_sap VARCHAR(50)')
    colunas_pedido = {coluna['name'] for coluna in inspect(db.engine).get_columns('pedido_compra')}
    if 'data_entrega' not in colunas_pedido:
        with db.engine.begin() as conexao:
            conexao.exec_driver_sql('ALTER TABLE pedido_compra ADD COLUMN data_entrega DATETIME')
    colunas_preco = {coluna['name'] for coluna in inspect(db.engine).get_columns('formacao_preco')}
    if 'frete_kg' not in colunas_preco:
        with db.engine.begin() as conexao:
            conexao.exec_driver_sql('ALTER TABLE formacao_preco ADD COLUMN frete_kg FLOAT')
    importar_formacao_precos()
    colunas_usuario = {coluna['name'] for coluna in inspect(db.engine).get_columns('usuario')}
    novas_colunas_usuario = {
        'email_confirmado': 'BOOLEAN NOT NULL DEFAULT 1',
        'email_confirmacao_token_hash': 'VARCHAR(64)',
        'email_confirmacao_expira_em': 'DATETIME'
    }
    for nome_coluna, definicao in novas_colunas_usuario.items():
        if nome_coluna not in colunas_usuario:
            with db.engine.begin() as conexao:
                conexao.exec_driver_sql(f'ALTER TABLE usuario ADD COLUMN {nome_coluna} {definicao}')
    colunas_fornecedor = {coluna['name'] for coluna in inspect(db.engine).get_columns('fornecedor')}
    novas_colunas_fornecedor = {
        'nome_fantasia': "VARCHAR(150) DEFAULT ''",
        'codigo': 'VARCHAR(50)',
        'uf': "VARCHAR(2) DEFAULT ''",
        'cidade': "VARCHAR(100) DEFAULT ''",
        'ativo': 'BOOLEAN NOT NULL DEFAULT 1'
    }
    for nome_coluna, definicao in novas_colunas_fornecedor.items():
        if nome_coluna not in colunas_fornecedor:
            with db.engine.begin() as conexao:
                conexao.exec_driver_sql(f'ALTER TABLE fornecedor ADD COLUMN {nome_coluna} {definicao}')
    colunas_rota = {coluna['name'] for coluna in inspect(db.engine).get_columns('rota_motorista')}
    colunas_mrp = {coluna['name'] for coluna in inspect(db.engine).get_columns('material_planejamento')}
    if 'item_id' not in colunas_mrp:
        with db.engine.begin() as conexao:
            conexao.exec_driver_sql('ALTER TABLE material_planejamento ADD COLUMN item_id INTEGER REFERENCES item(id)')
    if 'eh_demillus' not in colunas_mrp:
        with db.engine.begin() as conexao:
            conexao.exec_driver_sql('ALTER TABLE material_planejamento ADD COLUMN eh_demillus BOOLEAN NOT NULL DEFAULT 0')
    novas_colunas_produto_mrp = {
        'produto_nome': "VARCHAR(150)",
        'cliente': "VARCHAR(150)",
        'material_utilizado': "VARCHAR(150)",
        'planilha_aba': "VARCHAR(150)",
        'planilha_nome': "VARCHAR(255)",
        'historico_planilha': "TEXT"
    }
    for nome_coluna, definicao in novas_colunas_produto_mrp.items():
        if nome_coluna not in colunas_mrp:
            with db.engine.begin() as conexao:
                conexao.exec_driver_sql(f'ALTER TABLE material_planejamento ADD COLUMN {nome_coluna} {definicao}')
    if 'endereco' not in colunas_rota:
        with db.engine.begin() as conexao:
            conexao.exec_driver_sql("ALTER TABLE rota_motorista ADD COLUMN endereco VARCHAR(255) DEFAULT ''")
    if 'localizacao_mapa' not in colunas_rota:
        with db.engine.begin() as conexao:
            conexao.exec_driver_sql("ALTER TABLE rota_motorista ADD COLUMN localizacao_mapa VARCHAR(500) DEFAULT ''")
    colunas_pedido_compra = {coluna['name'] for coluna in inspect(db.engine).get_columns('pedido_compra')}
    if 'quantidade' not in colunas_pedido_compra:
        with db.engine.begin() as conexao:
            conexao.exec_driver_sql('ALTER TABLE pedido_compra ADD COLUMN quantidade FLOAT DEFAULT 0')
    if 'itens_pedido' not in colunas_pedido_compra:
        with db.engine.begin() as conexao:
            conexao.exec_driver_sql("ALTER TABLE pedido_compra ADD COLUMN itens_pedido TEXT DEFAULT ''")
    with db.engine.begin() as conexao:
        conexao.exec_driver_sql('UPDATE pedido_compra SET quantidade = (SELECT quantidade FROM solicitacao_compra WHERE id = pedido_compra.solicitacao_id) WHERE quantidade IS NULL OR quantidade = 0')
    colunas_pedido_comercial = {coluna['name'] for coluna in inspect(db.engine).get_columns('pedido_comercial')}
    if 'incluido_no_sap' not in colunas_pedido_comercial:
        with db.engine.begin() as conexao:
            conexao.exec_driver_sql('ALTER TABLE pedido_comercial ADD COLUMN incluido_no_sap BOOLEAN NOT NULL DEFAULT 0')
    for nome_coluna, definicao in {
        'valor_total': 'NUMERIC(12, 2) NOT NULL DEFAULT 0',
        'observacoes': 'TEXT DEFAULT ""',
        'resumo': 'TEXT DEFAULT ""'
    }.items():
        if nome_coluna not in colunas_pedido_comercial:
            with db.engine.begin() as conexao:
                conexao.exec_driver_sql(f'ALTER TABLE pedido_comercial ADD COLUMN {nome_coluna} {definicao}')
    colunas_pedido_comercial_item = {coluna['name'] for coluna in inspect(db.engine).get_columns('pedido_comercial_item')}
    for nome_coluna, definicao in {
        'valor': 'NUMERIC(12, 2) NOT NULL DEFAULT 0',
        'observacao': 'TEXT DEFAULT ""'
    }.items():
        if nome_coluna not in colunas_pedido_comercial_item:
            with db.engine.begin() as conexao:
                conexao.exec_driver_sql(f'ALTER TABLE pedido_comercial_item ADD COLUMN {nome_coluna} {definicao}')
    if 'produto' in colunas_pedido_comercial:
        with db.engine.begin() as conexao:
            conexao.exec_driver_sql('ALTER TABLE pedido_comercial DROP COLUMN produto')
    if 'quantidade' in colunas_pedido_comercial:
        with db.engine.begin() as conexao:
            conexao.exec_driver_sql('ALTER TABLE pedido_comercial DROP COLUMN quantidade')
    if 'imagem_filename' in colunas_pedido_comercial:
        with db.engine.begin() as conexao:
            conexao.exec_driver_sql('ALTER TABLE pedido_comercial DROP COLUMN imagem_filename')
    admin = Usuario.query.filter(db.func.lower(Usuario.email) == USUARIO_ADMIN_PROTEGIDO).first()
    if not admin:
        admin = Usuario(nome="Pedro Marinho", email=USUARIO_ADMIN_PROTEGIDO, perfil="admin", email_confirmado=True)
        admin.set_senha("123456")
        db.session.add(admin)
        db.session.commit()
        print("✅ [AUTOMÁTICO] Usuário padrão criado: pedro@pcp.com / senha: 123456")
    else:
        admin.perfil = 'admin'
        admin.email_confirmado = True
        db.session.commit()
    solicitacoes_sem_criador = SolicitacaoCompra.query.filter_by(usuario_id=None).all()
    usuarios_por_nome = {usuario.nome.strip().lower(): usuario for usuario in Usuario.query.all()}
    for solicitacao in solicitacoes_sem_criador:
        comentario = Comentario.query.filter_by(tipo_ref='SC', ref_id=solicitacao.id).filter(
            Comentario.texto.like('Solicitação criada por %')
        ).order_by(Comentario.id.asc()).first()
        correspondencia = re.search(r'Solicitação criada por (.+?)\.', comentario.texto) if comentario else None
        criador = usuarios_por_nome.get(correspondencia.group(1).strip().lower()) if correspondencia else None
        if criador:
            solicitacao.usuario_id = criador.id
    if solicitacoes_sem_criador:
        db.session.commit()