import csv
import difflib
import json
import os
import re
import time
import unicodedata
import uuid
from io import BytesIO, StringIO
from datetime import datetime, timedelta, date
import os
import unicodedata
from functools import lru_cache
from zoneinfo import ZoneInfo
from flask import Blueprint, request, jsonify, make_response, send_file, send_from_directory, g
from flask_login import login_required, current_user
from werkzeug.utils import secure_filename
from openpyxl import Workbook, load_workbook
from app.models import Item, SolicitacaoCompra, Cotacao, PedidoCompra, Fornecedor, Comentario, Notificacao, MaterialPlanejamento, CompraMRP, PedidoMRP, PedidoComercial, PedidoComercialItem, RotaMotorista, Anexo, Usuario, NivelAcesso, AgendaTarefa, FormacaoPreco, FormacaoPrecoFio, PAGINAS_SISTEMA, USUARIO_ADMIN_PROTEGIDO
from app.extensions import db
from app.services.compras_service import aprovar_solicitacao_service
from app.email_service import gerar_token_confirmacao, enviar_email_confirmacao
from decimal import Decimal, InvalidOperation
import pandas as pd

api_bp = Blueprint('api', __name__, url_prefix='/api/v1')
RECIFE_TZ = ZoneInfo('America/Recife')

project_root = os.path.abspath(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
UPLOAD_FOLDER = os.environ.get('UPLOAD_FOLDER', os.path.join(project_root, 'uploads'))
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
COMERCIAL_UPLOAD_FOLDER = os.path.join(UPLOAD_FOLDER, 'comercial')
os.makedirs(COMERCIAL_UPLOAD_FOLDER, exist_ok=True)

ALLOWED_EXTENSIONS = {'pdf', 'png', 'jpg', 'jpeg', 'xml'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def normalizar_texto(valor):
    texto = '' if valor is None else str(valor).strip()
    texto = texto.replace('º', 'o').replace('°', 'o').replace('\xa0', ' ')
    texto = ''.join(c for c in unicodedata.normalize('NFKD', texto) if not unicodedata.combining(c)).lower()
    return ' '.join(texto.replace('.', ' ').replace(':', ' ').split())

def item_cadastrado(valor):
    chave = normalizar_texto(valor)
    if not chave:
        return None
    itens = getattr(g, '_itens_cache', None)
    if itens is None:
        itens = g._itens_cache = Item.query.all()
    for item in itens:
        if chave in (normalizar_texto(item.codigo), normalizar_texto(item.descricao)):
            return item
    return None

def pode_gerenciar_compras(perfil):
    return perfil in ('comprador', 'admin', 'gerente')

def fornecedor_cadastrado(valor):
    chave = normalizar_texto(valor)
    if not chave:
        return None
    fornecedores = getattr(g, '_fornecedores_cache', None)
    if fornecedores is None:
        fornecedores = g._fornecedores_cache = Fornecedor.query.all()
    for fornecedor in fornecedores:
        if chave in (normalizar_texto(fornecedor.razao_social), normalizar_texto(fornecedor.nome_fantasia), normalizar_texto(fornecedor.cnpj)):
            return fornecedor
    return None

def resolver_setor_solicitante(setor=None, usuario=None):
    valor = str(setor or '').strip()
    if valor:
        return valor
    if usuario is not None and getattr(usuario, 'nome', None):
        return str(usuario.nome).strip() or 'Solicitante'
    return 'Solicitante'


def resumir_itens_solicitacao(itens):
    itens_validos = []
    for item in itens or []:
        nome = str(item.get('item') or '').strip() if isinstance(item, dict) else str(item or '').strip()
        if nome:
            itens_validos.append(nome)
    if not itens_validos:
        return 'Item não informado'
    return '; '.join(itens_validos)


def normalizar_lista_itens(itens):
    if itens is None:
        return []
    if isinstance(itens, dict):
        if 'itens' in itens:
            return normalizar_lista_itens(itens['itens'])
        if any(chave in itens for chave in ('item', 'produto', 'descricao', 'material', 'nome')):
            return [
                {
                    'item': str(itens.get('item') or itens.get('produto') or itens.get('descricao') or itens.get('material') or itens.get('nome') or '').strip(),
                    'quantidade': itens.get('quantidade', itens.get('qtd', itens.get('qty', 1)))
                }
            ]
        return []
    if isinstance(itens, str):
        itens_texto = itens.strip()
        if not itens_texto:
            return []
        partes = [parte.strip() for parte in re.split(r'[;\n,]+', itens_texto) if parte.strip()]
        return [{'item': parte, 'quantidade': 1.0} for parte in partes]
    if not isinstance(itens, list):
        return []

    normalizados = []
    for entrada in itens:
        if isinstance(entrada, dict):
            nome = entrada.get('item') or entrada.get('produto') or entrada.get('descricao') or entrada.get('material') or entrada.get('nome') or ''
            quantidade = entrada.get('quantidade', entrada.get('qtd', entrada.get('qty', 1)))
        elif isinstance(entrada, (list, tuple)) and len(entrada) >= 2:
            nome, quantidade = entrada[0], entrada[1]
        else:
            nome, quantidade = entrada, 1

        nome_texto = str(nome or '').strip()
        if not nome_texto:
            continue
        try:
            qtd = float(quantidade)
        except (TypeError, ValueError):
            qtd = 1.0
        if qtd <= 0:
            continue
        normalizados.append({'item': nome_texto, 'quantidade': qtd})
    return normalizados


def extrair_comando_adicionar_item(texto):
    comando = re.match(r'^\s*/add\s+(.+?)\s*$', str(texto or ''), re.IGNORECASE)
    if not comando:
        return None
    codigo = comando.group(1).strip()
    if len(codigo) >= 2 and codigo[0] == codigo[-1] and codigo[0] in ('"', "'"):
        codigo = codigo[1:-1].strip()
    return codigo or None


def extrair_comando_remover_item(texto):
    comando = re.match(r'^\s*/remove\s+(.+?)\s*$', str(texto or ''), re.IGNORECASE)
    if not comando:
        return None
    codigo = comando.group(1).strip()
    if len(codigo) >= 2 and codigo[0] == codigo[-1] and codigo[0] in ('"', "'"):
        codigo = codigo[1:-1].strip()
    return codigo or None


def extrair_comando_receber_itens(texto):
    comando = re.match(r'^\s*/receber\s+(.+?)\s*$', str(texto or ''), re.IGNORECASE)
    if not comando:
        return None
    codigos = [partes[0] or partes[1] or partes[2] for partes in re.findall(
        r'"([^"]+)"|\'([^\']+)\'|([^\s,;]+)', comando.group(1)
    )]
    return [codigo.strip() for codigo in codigos if codigo.strip()] or None


def atualizar_itens_solicitacao(solicitacao, itens):
    solicitacao.itens_detalhados = json.dumps(itens, ensure_ascii=False)
    solicitacao.item = resumir_itens_solicitacao(itens)
    solicitacao.quantidade = sum(float(item['quantidade']) for item in itens)


def adicionar_item_por_comando(solicitacao, codigo):
    item_cadastrado = item_cadastrado_por_codigo(codigo)
    if not item_cadastrado:
        raise ValueError(f'Item com código "{codigo}" não encontrado no cadastro.')

    try:
        itens = json.loads(solicitacao.itens_detalhados or '[]')
    except (TypeError, ValueError):
        itens = []
    if not isinstance(itens, list) or not itens:
        itens = normalizar_lista_itens(solicitacao.item)
        if len(itens) == 1:
            itens[0]['quantidade'] = float(solicitacao.quantidade or 0)

    itens.append({'codigo': item_cadastrado.codigo, 'item': item_cadastrado.descricao, 'quantidade': 1.0, 'status': 'pendente'})
    atualizar_itens_solicitacao(solicitacao, itens)
    return item_cadastrado


def item_cadastrado_por_codigo(codigo):
    codigo_normalizado = normalizar_texto(codigo)
    return next(
        (item for item in Item.query.all() if normalizar_texto(item.codigo) == codigo_normalizado),
        None
    )


def remover_item_por_comando(solicitacao, codigo):
    codigo_normalizado = normalizar_texto(codigo)
    item_cadastrado = item_cadastrado_por_codigo(codigo)
    if not item_cadastrado:
        raise ValueError(f'Item com código "{codigo}" não encontrado no cadastro.')

    try:
        itens = json.loads(solicitacao.itens_detalhados or '[]')
    except (TypeError, ValueError):
        itens = []
    if not isinstance(itens, list) or not itens:
        itens = normalizar_lista_itens(solicitacao.item)
        if len(itens) == 1:
            itens[0]['quantidade'] = float(solicitacao.quantidade or 0)
    if len(itens) <= 1:
        raise ValueError('A solicitação deve manter pelo menos um item.')

    descricao_normalizada = normalizar_texto(item_cadastrado.descricao)
    indice = next(
        (indice for indice in range(len(itens) - 1, -1, -1)
         if normalizar_texto(itens[indice].get('item')) in (codigo_normalizado, descricao_normalizada)),
        None
    )
    if indice is None:
        raise ValueError(f'O item com código "{codigo}" não está nesta solicitação.')

    itens.pop(indice)
    atualizar_itens_solicitacao(solicitacao, itens)
    return item_cadastrado


def receber_itens_por_comando(solicitacao, codigos):
    try:
        itens = json.loads(solicitacao.itens_detalhados or '[]')
    except (TypeError, ValueError):
        itens = []
    if not isinstance(itens, list) or not itens:
        itens = normalizar_lista_itens(solicitacao.item)
        if len(itens) == 1:
            itens[0]['quantidade'] = float(solicitacao.quantidade or 0)
    for item in itens:
        cadastro = item_cadastrado(item.get('item'))
        if cadastro:
            item['codigo'] = cadastro.codigo
        item['status'] = item.get('status') or 'pendente'
    itens_alterados = []
    for codigo in codigos:
        item_recebido = item_cadastrado_por_codigo(codigo)
        if not item_recebido:
            raise ValueError(f'Item com código "{codigo}" não encontrado no cadastro.')
        codigo_normalizado = normalizar_texto(item_recebido.codigo)
        encontrados = [item for item in itens if normalizar_texto(item.get('codigo')) == codigo_normalizado]
        if not encontrados:
            raise ValueError(f'O item com código "{codigo}" não está nesta solicitação.')
        for item in encontrados:
            item['codigo'] = item_recebido.codigo
            item['status'] = 'concluido'
        itens_alterados.append(item_recebido.descricao)
    atualizar_itens_solicitacao(solicitacao, itens)
    return itens_alterados

def solicitacao_duplicada(item, setor, numero_pedido_sap, ignorar_id=None):
    sap = str(numero_pedido_sap or '').strip()
    if not sap:
        return None
    item_ref = item_cadastrado(item)
    item_chave = normalizar_texto(item)
    setor_chave = normalizar_texto(setor)
    sap_chave = normalizar_texto(sap)
    solicitacoes = getattr(g, '_solicitacoes_cache', None)
    if solicitacoes is None:
        solicitacoes = g._solicitacoes_cache = SolicitacaoCompra.query.all()
    for solicitacao in solicitacoes:
        if ignorar_id is not None and solicitacao.id == ignorar_id:
            continue
        item_existente = item_cadastrado(solicitacao.item)
        mesmo_item = bool(item_ref and item_existente and item_ref.id == item_existente.id) or normalizar_texto(solicitacao.item) == item_chave
        if mesmo_item and normalizar_texto(solicitacao.setor_solicitante) == setor_chave and normalizar_texto(solicitacao.numero_pedido_sap) == sap_chave:
            return solicitacao
    return None

def notificar_nova_solicitacao(solicitacao):
    destinatarios = Usuario.query.filter(Usuario.perfil.in_(['comprador', 'admin'])).all()
    for usuario in destinatarios:
        db.session.add(Notificacao(
            usuario_id=usuario.id,
            titulo='Nova solicitação de compra',
            mensagem=f'SC-{1000 + solicitacao.id} aguardando análise: {solicitacao.item} | Quantidade total: {solicitacao.quantidade:g}',
            referencia_id=solicitacao.id
        ))

def sincronizar_notificacoes_solicitacoes_recentes():
    limite = datetime.utcnow() - timedelta(minutes=10)
    destinatarios = Usuario.query.filter(Usuario.perfil.in_(['comprador', 'admin'])).all()
    solicitacoes = SolicitacaoCompra.query.filter(SolicitacaoCompra.data_solicitacao >= limite).all()
    novas = 0
    for solicitacao in solicitacoes:
        for usuario in destinatarios:
            existe = Notificacao.query.filter_by(
                usuario_id=usuario.id, tipo='solicitacao', referencia_id=solicitacao.id
            ).first()
            if not existe:
                db.session.add(Notificacao(
                    usuario_id=usuario.id,
                    titulo='Nova solicitação de compra',
                    mensagem=f'SC-{1000 + solicitacao.id} aguardando análise: {solicitacao.item} | Quantidade: {solicitacao.quantidade:g}',
                    referencia_id=solicitacao.id
                ))
                novas += 1
    if novas:
        db.session.commit()

def item_corresponde(valor, termo):
    """Compara descrição ou código do item informado na busca."""
    valor_normalizado = normalizar_texto(valor)
    termo_normalizado = normalizar_texto(termo)
    if not valor_normalizado or not termo_normalizado:
        return False
    if termo_normalizado in valor_normalizado:
        return True
    item = item_cadastrado(termo)
    return bool(item and normalizar_texto(item.descricao) in valor_normalizado)

def nome_item_completo(valor):
    """Retorna a descrição cadastrada mesmo quando o valor é apenas o código."""
    texto = str(valor or '').strip()
    if not texto:
        return 'Item não informado'
    item = item_cadastrado(texto)
    if item:
        return item.descricao
    chave = normalizar_texto(texto)
    item = next((registro for registro in Item.query.all() if chave in normalizar_texto(registro.descricao)), None)
    return item.descricao if item else texto

def parse_preco(valor):
    if valor is None or str(valor).strip() == '':
        return None
    if isinstance(valor, (int, float, Decimal)):
        return Decimal(str(valor))
    texto = str(valor).strip().replace('R$', '').replace(' ', '')
    if ',' in texto:
        texto = texto.replace('.', '').replace(',', '.')
    return Decimal(texto)

def extrair_previsao(texto):
    correspondencia = re.match(r'^\s*/previs(?:ão|ao)\s*:?\s*(\d{2}/\d{2}/\d{4}|\d{4}-\d{2}-\d{2})(?:\s+|$)', texto, re.IGNORECASE)
    if not correspondencia:
        return None
    valor_data = correspondencia.group(1)
    formato = '%d/%m/%Y' if '/' in valor_data else '%Y-%m-%d'
    try:
        return datetime.strptime(valor_data, formato).date()
    except ValueError:
        raise ValueError('Informe uma data válida após /previsão, por exemplo: /previsão 29/08/2026.')

# ===============================================
# CADASTRO DE ITENS
# ===============================================
@api_bp.route('/itens', methods=['GET'])
@login_required
def get_itens():
    itens = Item.query.order_by(Item.descricao.asc()).all()
    return jsonify([item.to_dict() for item in itens]), 200

@api_bp.route('/itens/proximo-codigo', methods=['GET'])
@login_required
def get_proximo_codigo_item():
    if current_user.perfil not in ['comprador', 'admin']:
        return jsonify({"erro": "Acesso negado."}), 403
    maior_numero = 0
    prefixo = 'U'
    for item in Item.query.with_entities(Item.codigo).all():
        correspondencia = re.fullmatch(r'([A-Z]+)(\d+)', str(item[0] or '').strip().upper())
        if correspondencia:
            prefixo = correspondencia.group(1)
            maior_numero = max(maior_numero, int(correspondencia.group(2)))
    return jsonify({"codigo": f"{prefixo}{maior_numero + 1:04d}"}), 200

@api_bp.route('/precos', methods=['GET'])
@login_required
def get_precos():
    if current_user.perfil not in ('comprador', 'admin'):
        return jsonify({'erro': 'Acesso negado.'}), 403
    agrupados = {}
    for registro in FormacaoPreco.query.order_by(FormacaoPreco.material_nome.asc(), FormacaoPreco.id.asc()).all():
        agrupados.setdefault(registro.material_nome, []).append(registro.to_dict())
    return jsonify(agrupados), 200

def _normalizar_celula_preco(valor):
    if valor is None or pd.isna(valor):
        return ''
    return ' '.join(str(valor).replace(':', '').strip().upper().split())

def _numero_celula_preco(valor):
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

def _texto_celula_preco(valor):
    if valor is None or pd.isna(valor):
        return ''
    if isinstance(valor, (pd.Timestamp, datetime)):
        return valor.strftime('%d/%m/%Y')
    return str(valor).strip()

def _valor_rotulo_preco(linhas, rotulos):
    for linha in linhas:
        for indice, celula in enumerate(linha or []):
            if _normalizar_celula_preco(celula) in rotulos:
                return next((valor for valor in linha[indice + 1:] if valor is not None and str(valor).strip()), None)
    return None

def _importar_formacao_precos_excel(arquivo):
    registros = []
    conteudo = arquivo.read() if hasattr(arquivo, 'read') else arquivo
    planilha = pd.ExcelFile(BytesIO(conteudo))
    calculado = load_workbook(BytesIO(conteudo), data_only=True)
    for aba in planilha.sheet_names:
        linhas = pd.read_excel(planilha, sheet_name=aba, header=None).where(lambda tabela: pd.notna(tabela), None).values.tolist()
        material = aba.strip()
        fornecedor = 'Lip Lip' if 'LIP' in _normalizar_celula_preco(aba) else ('C&T' if 'C&T' in aba.upper() or 'CORES' in _normalizar_celula_preco(aba) else material)
        indice_cabecalho = next((i for i, linha in enumerate(linhas) if 'DATA RECEBIMENTO' in [_normalizar_celula_preco(v) for v in linha]), None)
        if indice_cabecalho is not None:
            cabecalho = [_normalizar_celula_preco(v) for v in linhas[indice_cabecalho]]
            for linha in linhas[indice_cabecalho + 1:]:
                if not any(v is not None and str(v).strip() for v in linha):
                    continue
                valores = {nome: linha[indice] if indice < len(linha) else None for indice, nome in enumerate(cabecalho)}
                perda_percentual = _numero_celula_preco(valores.get('%'))
                if perda_percentual is not None and perda_percentual <= 1:
                    perda_percentual *= 100
                registros.append(FormacaoPreco(
                    material_nome=material, fornecedor_servico=fornecedor,
                    data_recebimento=_texto_celula_preco(valores.get('DATA RECEBIMENTO')),
                    nfe=_texto_celula_preco(valores.get('NFE')),
                    valor_fio_kg=_numero_celula_preco(valores.get('VALOR FIO')),
                    valor_servico_kg=_numero_celula_preco(valores.get('VLR SERVICO') or valores.get('SERVICO')),
                    frete_kg=_numero_celula_preco(valores.get('FRETE KG')),
                    peso_bruto=_numero_celula_preco(valores.get('PESO BRUTO')),
                    peso_liquido=_numero_celula_preco(valores.get('PESO LIQUIDO')),
                    perda_kg=_numero_celula_preco(valores.get('PERDA - KG')),
                    perda_percentual=perda_percentual,
                    preco_final_kg=_numero_celula_preco(valores.get('PRECO POR KG'))
                ))
        else:
            linhas_calculadas = [[celula.value for celula in linha] for linha in calculado[aba].iter_rows()]
            linha_fio = next((linha for linha in linhas if linha and _normalizar_celula_preco(linha[0]) in {'VALOR FIO ALG.', 'VALOR FIO'}), [])
            linha_fio_poli = next((linha for linha in linhas if linha and _normalizar_celula_preco(linha[0]) == 'VALOR FIO POLI.'), [])
            linha_servico = next((linha for linha in linhas if linha and _normalizar_celula_preco(linha[0]) == 'SERVICO'), [])
            linha_frete = next((linha for linha in linhas if linha and _normalizar_celula_preco(linha[0]) in {'FRETE FIO', 'FRETE'}), [])
            peso_bruto = sum(_numero_celula_preco(linha[1] if len(linha) > 1 else None) or 0 for linha in (linha_fio, linha_fio_poli)) or None
            peso_liquido = _numero_celula_preco(_valor_rotulo_preco(linhas_calculadas, {'PESO LIQUIDO'}))
            perda_kg = _numero_celula_preco(_valor_rotulo_preco(linhas_calculadas, {'PERDA KG', 'PERDA'}))
            perda_percentual = perda_kg / peso_bruto * 100 if perda_kg is not None and peso_bruto else None
            registros.append(FormacaoPreco(
                material_nome=material, fornecedor_servico=fornecedor,
                data_recebimento=_texto_celula_preco(linhas[0][0] if linhas and linhas[0] else ''),
                nfe=_texto_celula_preco(_valor_rotulo_preco(linhas, {'NF', 'NFE'})),
                valor_fio_kg=_numero_celula_preco(linha_fio[2] if len(linha_fio) > 2 else None),
                valor_servico_kg=_numero_celula_preco(linha_servico[2] if len(linha_servico) > 2 else None),
                frete_kg=_numero_celula_preco(linha_frete[2] if len(linha_frete) > 2 else None),
                peso_bruto=peso_bruto, peso_liquido=peso_liquido, perda_kg=perda_kg,
                perda_percentual=perda_percentual,
                preco_final_kg=_numero_celula_preco(_valor_rotulo_preco(linhas_calculadas, {'PRECO FINAL', 'PRECO POR KG'}))
            ))
    return registros

@api_bp.route('/precos/importar', methods=['POST'])
@login_required
def importar_precos_excel():
    if current_user.perfil not in ('comprador', 'admin'):
        return jsonify({'erro': 'Acesso negado.'}), 403
    arquivo = request.files.get('arquivo')
    if not arquivo or not arquivo.filename.lower().endswith(('.xlsx', '.xlsm')):
        return jsonify({'erro': 'Envie um arquivo Excel .xlsx ou .xlsm.'}), 400
    try:
        registros = _importar_formacao_precos_excel(arquivo)
        if not registros:
            return jsonify({'erro': 'Nenhum registro de formação de preço foi encontrado nas abas.'}), 400
        db.session.add_all(registros)
        db.session.commit()
        return jsonify({'mensagem': f'{len(registros)} registro(s) importado(s) com sucesso.', 'quantidade': len(registros)}), 201
    except Exception as erro:
        db.session.rollback()
        return jsonify({'erro': 'Falha ao importar planilha.', 'detalhes': str(erro)}), 400

def _calcular_preco_formacao(dados):
    def numero(nome):
        valor = dados.get(nome)
        return float(valor) if valor not in (None, '') else None
    fios = dados.get('fios') or []
    fio = sum(numero_fio for numero_fio in (float(fio.get('valor_kg')) for fio in fios if fio.get('valor_kg') not in (None, '')))
    fio = fio or numero('valor_fio_kg') or 0
    servico, frete = numero('valor_servico_kg') or 0, numero('frete_kg') or 0
    bruto, liquido = numero('peso_bruto'), numero('peso_liquido')
    perda = numero('perda_kg')
    if perda is None and bruto is not None and liquido is not None:
        perda = bruto - liquido
    percentual = numero('perda_percentual')
    if percentual is None and perda is not None and bruto:
        percentual = perda / bruto * 100
    preco = numero('preco_final_kg')
    if preco is None and liquido:
        preco = (fio + servico + frete) * bruto / liquido if bruto else (fio + servico + frete)
    return percentual, perda, preco

@api_bp.route('/precos', methods=['POST'])
@login_required
def create_preco():
    if current_user.perfil not in ('comprador', 'admin'):
        return jsonify({'erro': 'Acesso negado.'}), 403
    data = request.get_json() or {}
    if not str(data.get('material_nome', '')).strip():
        return jsonify({'erro': 'Informe o material.'}), 400
    try:
        fios = data.get('fios') or []
        percentual, perda, preco = _calcular_preco_formacao(data)
        valor_fios = sum(float(fio['valor_kg']) for fio in fios if fio.get('valor_kg') not in (None, ''))
        registro = FormacaoPreco(material_nome=str(data['material_nome']).strip(), fornecedor_servico=str(data.get('fornecedor_servico', '') or '').strip(), data_recebimento=str(data.get('data_recebimento', '') or '').strip(), nfe=str(data.get('nfe', '') or '').strip(), observacao=str(data.get('observacao', '') or '').strip(), valor_fio_kg=valor_fios or data.get('valor_fio_kg'), valor_servico_kg=data.get('valor_servico_kg'), frete_kg=data.get('frete_kg'), peso_bruto=data.get('peso_bruto'), peso_liquido=data.get('peso_liquido'), perda_kg=perda, perda_percentual=percentual, preco_final_kg=preco)
        db.session.add(registro)
        registro.fios = [FormacaoPrecoFio(nome=str(fio.get('nome', '')).strip(), valor_kg=float(fio['valor_kg'])) for fio in fios if str(fio.get('nome', '')).strip() and fio.get('valor_kg') not in (None, '')]
        db.session.commit()
        return jsonify(registro.to_dict()), 201
    except (TypeError, ValueError):
        db.session.rollback()
        return jsonify({'erro': 'Valores numéricos inválidos.'}), 400

@api_bp.route('/precos/<int:id>', methods=['PUT'])
@login_required
def update_preco(id):
    if current_user.perfil not in ('comprador', 'admin'):
        return jsonify({'erro': 'Acesso negado.'}), 403
    registro = FormacaoPreco.query.get_or_404(id)
    data = request.get_json() or {}
    try:
        campos = ('material_nome', 'fornecedor_servico', 'data_recebimento', 'nfe', 'observacao', 'valor_fio_kg', 'valor_servico_kg', 'frete_kg', 'peso_bruto', 'peso_liquido')
        valores = {campo: data[campo] for campo in campos if campo in data}
        for campo, valor in valores.items(): setattr(registro, campo, valor)
        if 'fios' in data:
            registro.fios = [FormacaoPrecoFio(nome=str(fio.get('nome', '')).strip(), valor_kg=float(fio['valor_kg'])) for fio in data['fios'] if str(fio.get('nome', '')).strip() and fio.get('valor_kg') not in (None, '')]
            registro.valor_fio_kg = sum(fio.valor_kg for fio in registro.fios) or None
        calculo = {campo: getattr(registro, campo) for campo in ('valor_fio_kg', 'valor_servico_kg', 'frete_kg', 'peso_bruto', 'peso_liquido')}
        calculo['fios'] = data.get('fios', [fio.to_dict() for fio in registro.fios])
        registro.perda_percentual, registro.perda_kg, registro.preco_final_kg = _calcular_preco_formacao(calculo)
        db.session.commit()
        return jsonify(registro.to_dict()), 200
    except (TypeError, ValueError):
        db.session.rollback()
        return jsonify({'erro': 'Valores numéricos inválidos.'}), 400

@api_bp.route('/precos/<int:id>', methods=['DELETE'])
@login_required
def delete_preco(id):
    if current_user.perfil not in ('comprador', 'admin'):
        return jsonify({'erro': 'Acesso negado.'}), 403
    registro = FormacaoPreco.query.get_or_404(id)
    db.session.delete(registro)
    db.session.commit()
    return jsonify({'mensagem': 'Registro excluído.'}), 200

@api_bp.route('/itens', methods=['POST'])
@login_required
def create_item():
    if current_user.perfil not in ['comprador', 'admin']:
        return jsonify({"erro": "Acesso negado."}), 403
    data = request.get_json() or {}
    codigo = str(data.get('codigo', '')).strip()
    if not codigo:
        maior_numero = 0
        prefixo = 'U'
        for item in Item.query.with_entities(Item.codigo).all():
            correspondencia = re.fullmatch(r'([A-Z]+)(\d+)', str(item[0] or '').strip().upper())
            if correspondencia:
                prefixo = correspondencia.group(1)
                maior_numero = max(maior_numero, int(correspondencia.group(2)))
        codigo = f"{prefixo}{maior_numero + 1:04d}"
    descricao = str(data.get('descricao', '')).strip()
    if not codigo or not descricao:
        return jsonify({"erro": "Código e descrição são obrigatórios."}), 400
    if Item.query.filter_by(codigo=codigo).first():
        return jsonify({"erro": "Já existe um item com este código."}), 400
    try:
        novo = Item(
            codigo=codigo,
            descricao=descricao,
            estoque=float(data.get('estoque', 0) or 0),
            grupo=str(data.get('grupo', '') or '').strip(),
            fabricante=str(data.get('fabricante', '') or '').strip(),
            unidade=str(data.get('unidade', 'UN') or 'UN').strip(),
            ultimo_preco=parse_preco(data.get('ultimo_preco'))
        )
        db.session.add(novo)
        db.session.commit()
        return jsonify(novo.to_dict()), 201
    except (ValueError, TypeError, InvalidOperation):
        db.session.rollback()
        return jsonify({"erro": "Estoque ou último preço inválido."}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({"erro": "Erro ao cadastrar item", "detalhes": str(e)}), 500

@api_bp.route('/itens/<int:id>', methods=['PUT'])
@login_required
def update_item(id):
    if current_user.perfil not in ['comprador', 'admin']:
        return jsonify({"erro": "Acesso negado."}), 403
    item = Item.query.get_or_404(id)
    data = request.get_json() or {}
    codigo = str(data.get('codigo', '')).strip()
    descricao = str(data.get('descricao', '')).strip()
    if not codigo or not descricao:
        return jsonify({"erro": "Código e descrição são obrigatórios."}), 400
    duplicado = Item.query.filter(Item.codigo == codigo, Item.id != id).first()
    if duplicado:
        return jsonify({"erro": "Já existe outro item com este código."}), 400
    try:
        item.codigo = codigo
        item.descricao = descricao
        item.estoque = float(data.get('estoque', 0) or 0)
        item.grupo = str(data.get('grupo', '') or '').strip()
        item.fabricante = str(data.get('fabricante', '') or '').strip()
        item.unidade = str(data.get('unidade', 'UN') or 'UN').strip()
        item.ultimo_preco = parse_preco(data.get('ultimo_preco'))
        db.session.commit()
        return jsonify(item.to_dict()), 200
    except (ValueError, TypeError, InvalidOperation):
        db.session.rollback()
        return jsonify({"erro": "Estoque ou último preço inválido."}), 400

@api_bp.route('/itens/<int:id>', methods=['DELETE'])
@login_required
def delete_item(id):
    if current_user.perfil not in ['comprador', 'admin']:
        return jsonify({"erro": "Acesso negado."}), 403
    item = Item.query.get_or_404(id)
    try:
        db.session.delete(item)
        db.session.commit()
        return jsonify({"mensagem": "Item excluído com sucesso."}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"erro": "Não foi possível excluir o item.", "detalhes": str(e)}), 409

@api_bp.route('/itens/importar', methods=['POST'])
@login_required
def importar_itens():
    if current_user.perfil not in ['comprador', 'admin']:
        return jsonify({"erro": "Acesso negado."}), 403
    arquivo = request.files.get('arquivo')
    if not arquivo or not arquivo.filename.lower().endswith('.xlsx'):
        return jsonify({"erro": "Envie um arquivo Excel .xlsx."}), 400
    try:
        planilha = load_workbook(arquivo, read_only=True, data_only=True).active
        linhas = list(planilha.iter_rows(values_only=True))
        if not linhas:
            return jsonify({"erro": "A planilha está vazia."}), 400
        aliases = {
            'codigo': ['no do item', 'n do item', 'codigo', 'código'],
            'descricao': ['descricao do item', 'descrição do item', 'descricao'],
            'estoque': ['em estoque', 'estoque'],
            'grupo': ['grupo de itens', 'grupo'],
            'fabricante': ['fabricante'],
            'unidade': ['unidade de medida', 'unidade'],
            'ultimo_preco': ['ultimo preco de compra', 'último preço de compra', 'ultimo preco', 'preco']
        }
        linha_cabecalho = next((indice for indice, linha in enumerate(linhas[:10]) if 'descricao do item' in [normalizar_texto(valor) for valor in linha]), None)
        if linha_cabecalho is None:
            return jsonify({"erro": "A planilha deve conter as colunas 'Nº do item' e 'Descrição do item'."}), 400
        cabecalhos = [normalizar_texto(valor) for valor in linhas[linha_cabecalho]]
        indices = {}
        for campo, nomes in aliases.items():
            for nome in nomes:
                nome_normalizado = normalizar_texto(nome)
                if nome_normalizado in cabecalhos:
                    indices[campo] = cabecalhos.index(nome_normalizado)
                    break
        if 'codigo' not in indices or 'descricao' not in indices:
            return jsonify({"erro": "A planilha deve conter as colunas 'Nº do item' e 'Descrição do item'."}), 400

        importados = 0
        atualizados = 0
        ignorados = []
        for numero_linha, valores in enumerate(linhas[linha_cabecalho + 1:], start=linha_cabecalho + 2):
            codigo = str(valores[indices['codigo']] or '').strip()
            descricao = str(valores[indices['descricao']] or '').strip()
            if not codigo and not descricao:
                continue
            if not codigo or not descricao:
                ignorados.append(f"linha {numero_linha}: código e descrição são obrigatórios")
                continue
            item = Item.query.filter_by(codigo=codigo).first()
            if not item:
                item = Item(codigo=codigo, descricao=descricao)
                db.session.add(item)
                importados += 1
            else:
                atualizados += 1
                item.descricao = descricao
            for campo, atributo in [('estoque', 'estoque'), ('grupo', 'grupo'), ('fabricante', 'fabricante'), ('unidade', 'unidade')]:
                if campo in indices and valores[indices[campo]] is not None:
                    setattr(item, atributo, str(valores[indices[campo]]).strip()) if campo != 'estoque' else setattr(item, atributo, float(valores[indices[campo]] or 0))
            if 'ultimo_preco' in indices and valores[indices['ultimo_preco']] is not None:
                item.ultimo_preco = parse_preco(valores[indices['ultimo_preco']])
        db.session.commit()
        return jsonify({"importados": importados, "atualizados": atualizados, "ignorados": ignorados}), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({"erro": "Falha ao importar planilha", "detalhes": str(e)}), 400

@api_bp.route('/itens/modelo', methods=['GET'])
@login_required
def baixar_modelo_itens():
    planilha = Workbook()
    aba = planilha.active
    aba.title = 'Itens'
    aba.append(['Nº do item', 'Descrição do item', 'Em estoque', 'Grupo de itens', 'Fabricante', 'Unidade', 'Último preço de compra'])
    aba.append(['A0001', 'SEMI ACABADO MASC 0 PIQUET BRANCO 001 60% PES 40%CO 190GR TUB 1,20 CAIMAN', 20, 'SEMI ACABADO', 'Nenhum', 'UN', 2.33])
    aba.freeze_panes = 'A2'
    for coluna in aba.columns:
        aba.column_dimensions[coluna[0].column_letter].width = min(max(len(str(coluna[0].value or '')) + 2, 14), 55)
    arquivo = BytesIO()
    planilha.save(arquivo)
    arquivo.seek(0)
    return send_file(arquivo, as_attachment=True, download_name='modelo_importacao_itens.xlsx', mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

# ===============================================
# SESSÃO / USUÁRIO ATUAL
# ===============================================
@api_bp.route('/me', methods=['GET'])
@login_required
def get_current_user():
    dados = current_user.to_dict()
    nivel = NivelAcesso.query.filter_by(nome=current_user.perfil).first()
    dados['permissoes'] = nivel.paginas() if nivel else []
    return jsonify(dados), 200

@api_bp.route('/agenda', methods=['GET'])
@login_required
def get_agenda():
    data = (request.args.get('data') or datetime.now(RECIFE_TZ).strftime('%Y-%m-%d')).strip()
    try:
        datetime.strptime(data, '%Y-%m-%d')
    except ValueError:
        return jsonify({'erro': 'Informe uma data válida no formato AAAA-MM-DD.'}), 400
    tarefas = AgendaTarefa.query.filter(
        AgendaTarefa.data == data,
        db.or_(AgendaTarefa.usuario_id == current_user.id, AgendaTarefa.destinatarios.any(id=current_user.id))
    ).order_by(AgendaTarefa.concluida.asc(), AgendaTarefa.ordem.asc(), AgendaTarefa.id.asc()).all()
    return jsonify([tarefa.to_dict() for tarefa in tarefas]), 200

@api_bp.route('/agenda/usuarios', methods=['GET'])
@login_required
def get_usuarios_agenda():
    usuarios = Usuario.query.filter(Usuario.id != current_user.id).order_by(Usuario.nome.asc()).all()
    return jsonify([{'id': usuario.id, 'nome': usuario.nome, 'email': usuario.email} for usuario in usuarios]), 200

@api_bp.route('/agenda', methods=['POST'])
@login_required
def create_agenda_tarefa():
    dados = request.get_json() or {}
    titulo = str(dados.get('titulo', '') or '').strip()
    data = str(dados.get('data', '') or datetime.now(RECIFE_TZ).strftime('%Y-%m-%d')).strip()
    if not titulo:
        return jsonify({'erro': 'Informe o título da tarefa.'}), 400
    try:
        destinatarios_ids = {int(usuario_id) for usuario_id in dados.get('destinatarios', [])}
    except (TypeError, ValueError):
        return jsonify({'erro': 'Destinatários inválidos.'}), 400
    destinatarios_ids.discard(current_user.id)
    destinatarios = Usuario.query.filter(Usuario.id.in_(destinatarios_ids)).all() if destinatarios_ids else []
    if len(destinatarios) != len(destinatarios_ids):
        return jsonify({'erro': 'Um ou mais destinatários não foram encontrados.'}), 400
    try:
        datetime.strptime(data, '%Y-%m-%d')
    except ValueError:
        return jsonify({'erro': 'Informe uma data válida no formato AAAA-MM-DD.'}), 400
    maior_ordem = db.session.query(db.func.max(AgendaTarefa.ordem)).filter_by(usuario_id=current_user.id, data=data).scalar() or 0
    tarefa = AgendaTarefa(usuario_id=current_user.id, titulo=titulo, observacao=str(dados.get('observacao', '') or '').strip(), data=data, ordem=maior_ordem + 1, destinatarios=destinatarios)
    db.session.add(tarefa)
    db.session.commit()
    return jsonify(tarefa.to_dict()), 201

@api_bp.route('/agenda/<int:id>', methods=['PUT'])
@login_required
def update_agenda_tarefa(id):
    tarefa = AgendaTarefa.query.filter_by(id=id, usuario_id=current_user.id).first_or_404()
    dados = request.get_json() or {}
    if 'titulo' in dados:
        titulo = str(dados.get('titulo') or '').strip()
        if not titulo:
            return jsonify({'erro': 'Informe o título da tarefa.'}), 400
        tarefa.titulo = titulo
    if 'observacao' in dados:
        tarefa.observacao = str(dados.get('observacao') or '').strip()
    if 'concluida' in dados:
        tarefa.concluida = bool(dados['concluida'])
    if 'destinatarios' in dados:
        try:
            destinatarios_ids = {int(usuario_id) for usuario_id in dados['destinatarios']}
        except (TypeError, ValueError):
            return jsonify({'erro': 'Destinatários inválidos.'}), 400
        destinatarios_ids.discard(current_user.id)
        destinatarios = Usuario.query.filter(Usuario.id.in_(destinatarios_ids)).all() if destinatarios_ids else []
        if len(destinatarios) != len(destinatarios_ids):
            return jsonify({'erro': 'Um ou mais destinatários não foram encontrados.'}), 400
        tarefa.destinatarios = destinatarios
        for destinatario in destinatarios:
            db.session.add(Notificacao(
                usuario_id=destinatario.id,
                titulo='Nova mensagem da agenda',
                mensagem=f'{current_user.nome} enviou: {tarefa.titulo}',
                tipo='agenda', referencia_id=tarefa.id
            ))
    db.session.commit()
    return jsonify(tarefa.to_dict()), 200

@api_bp.route('/agenda/<int:id>', methods=['GET'])
@login_required
def get_agenda_tarefa(id):
    tarefa = AgendaTarefa.query.filter(
        AgendaTarefa.id == id,
        db.or_(AgendaTarefa.usuario_id == current_user.id, AgendaTarefa.destinatarios.any(id=current_user.id))
    ).first_or_404()
    dados = tarefa.to_dict()
    dados['rastreabilidade'] = [
        {'etapa': 'Criada', 'data': tarefa.data_criacao.strftime('%d/%m/%Y %H:%M'), 'detalhe': f'Criada por {tarefa.criador.nome}.'},
        {'etapa': 'Mensagem enviada', 'data': tarefa.data_criacao.strftime('%d/%m/%Y %H:%M'), 'detalhe': f'Enviada por {tarefa.criador.nome}.'}
    ]
    dados['comentarios'] = [tarefa.observacao] if tarefa.observacao else []
    return jsonify(dados), 200

@api_bp.route('/agenda/<int:id>/enviar', methods=['POST'])
@login_required
def enviar_agenda_tarefa(id):
    tarefa = AgendaTarefa.query.get_or_404(id)
    if tarefa.usuario_id != current_user.id and current_user.perfil != 'admin':
        return jsonify({'erro': 'Somente o criador ou um administrador pode enviar esta mensagem.'}), 403
    dados = request.get_json() or {}
    try:
        destinatarios_ids = {int(usuario_id) for usuario_id in dados.get('destinatarios', [])}
    except (TypeError, ValueError):
        return jsonify({'erro': 'Destinatários inválidos.'}), 400
    destinatarios_ids.discard(current_user.id)
    destinatarios = Usuario.query.filter(Usuario.id.in_(destinatarios_ids)).all() if destinatarios_ids else []
    if not destinatarios:
        return jsonify({'erro': 'Selecione pelo menos um destinatário.'}), 400
    observacao = str(dados.get('observacao', tarefa.observacao) or '').strip()
    tarefa.observacao = observacao
    tarefa.destinatarios = destinatarios
    for destinatario in destinatarios:
        db.session.add(Notificacao(
            usuario_id=destinatario.id,
            titulo='Nova mensagem da agenda',
            mensagem=f'{current_user.nome} enviou: {tarefa.titulo}',
            tipo='agenda', referencia_id=tarefa.id
        ))
    db.session.commit()
    return jsonify(tarefa.to_dict()), 200

@api_bp.route('/agenda/<int:id>', methods=['DELETE'])
@login_required
def delete_agenda_tarefa(id):
    tarefa = AgendaTarefa.query.filter_by(id=id, usuario_id=current_user.id).first_or_404()
    db.session.delete(tarefa)
    db.session.commit()
    return jsonify({'mensagem': 'Tarefa removida.'}), 200

@api_bp.route('/dashboard/consulta', methods=['POST'])
@login_required
def consultar_dashboard():
    pergunta = str((request.get_json() or {}).get('pergunta', '')).strip()
    texto = normalizar_texto(pergunta)
    if not texto:
        return jsonify({"resposta": "Digite uma pergunta para consultar a operação.", "cards": []}), 400

    def dinheiro(valor):
        return f"R$ {valor:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')

    def valor_depois_de(*marcadores):
        for marcador in marcadores:
            if marcador in texto:
                return texto.split(marcador, 1)[1].strip(' ?:-')
        return texto

    def termo_especifico_rota(valor):
        palavras_ignoradas = {'qual', 'quais', 'quando', 'onde', 'esta', 'estao', 'na', 'no', 'nas', 'nos', 'da', 'do', 'das', 'dos', 'de', 'a', 'o', 'as', 'os', 'uma', 'um', 'para', 'por', 'hoje', 'amanha', 'amanhã', 'rota', 'rotas', 'motorista', 'destino', 'endereco', 'gps', 'tem', 'existem'}
        uteis = [palavra for palavra in normalizar_texto(valor).split() if palavra not in palavras_ignoradas]
        return ' '.join(uteis)

    def periodo_consulta():
        agora = datetime.now(RECIFE_TZ).replace(tzinfo=None)
        if 'hoje' in texto:
            return agora.replace(hour=0, minute=0, second=0, microsecond=0), agora
        intervalo = re.search(r'ultimos?\s+(\d+)\s+mes(?:es)?', texto)
        if intervalo:
            return (agora - timedelta(days=30 * int(intervalo.group(1)))).replace(hour=0, minute=0, second=0, microsecond=0), agora
        datas = re.search(r'(\d{1,2})/(\d{1,2})\s*(?:a|ate)\s*(\d{1,2})/(\d{1,2})', texto)
        if datas:
            dia_inicial, mes_inicial, dia_final, mes_final = map(int, datas.groups())
            return datetime(agora.year, mes_inicial, dia_inicial), datetime(agora.year, mes_final, dia_final, 23, 59, 59)
        return None, None

    cards = []
    inicio_periodo, fim_periodo = periodo_consulta()
    termos_rota = ('rota' in texto or 'motorista' in texto or 'destino' in texto or 'endereco' in texto or 'gps' in texto)
    termos_quantidade = ('quantidade' in texto or 'qtd' in texto or 'solicitada' in texto or 'solicitado' in texto)
    termos_compra = ('comprado' in texto or 'comprada' in texto or 'comprou' in texto)
    termos_chegada = ('chegar' in texto or 'chegada' in texto or 'previsto' in texto or 'previsao' in texto or 'entrega' in texto)
    if termos_chegada and not termos_rota:
        agora = datetime.now(RECIFE_TZ).date()
        data_alvo = agora + timedelta(days=1) if 'amanha' in texto or 'amanhã' in texto else agora
        pedidos_candidatos = PedidoCompra.query.filter(PedidoCompra.status.notin_(['cancelado', 'entregue'])).order_by(PedidoCompra.data_emissao.asc()).all()
        pedidos = [pedido for pedido in pedidos_candidatos if (pedido.data_emissao + timedelta(days=pedido.prazo_dias or 7)).date() == data_alvo]
        if pedidos:
            resposta = f"Encontrei {len(pedidos)} pedido(s) previsto(s) para chegar em {data_alvo.strftime('%d/%m/%Y')}."
            cards = [{"tipo": "PO", "id": f"PO-{500 + pedido.id}", "titulo": pedido.item_nome or (pedido.solicitacao.item if pedido.solicitacao else 'Pedido'), "subtitulo": f"{pedido.fornecedor} | {data_alvo.strftime('%d/%m/%Y')} | {pedido.status}"} for pedido in pedidos[:8]]
        else:
            resposta = f"Não encontrei pedidos previstos para chegar em {data_alvo.strftime('%d/%m/%Y')}."
    elif termos_compra and not termos_rota:
        marcadores_compra = ('item', 'produto', 'de', 'da', 'do')
        termo_item = valor_depois_de(*marcadores_compra)
        palavras_ignoradas = {'qual', 'quanto', 'quando', 'foi', 'comprado', 'comprada', 'comprou', 'compra', 'item', 'produto', 'ontem', 'hoje'}
        termo_item = ' '.join(palavra for palavra in normalizar_texto(termo_item).split() if palavra not in palavras_ignoradas).strip()
        consulta_pedidos = PedidoCompra.query.filter(PedidoCompra.status != 'cancelado')
        if inicio_periodo and fim_periodo:
            consulta_pedidos = consulta_pedidos.filter(PedidoCompra.data_emissao >= inicio_periodo, PedidoCompra.data_emissao <= fim_periodo)
        pedidos_candidatos = consulta_pedidos.order_by(PedidoCompra.data_emissao.desc()).all()
        pedidos = [pedido for pedido in pedidos_candidatos if termo_item and any(item_corresponde(nome, termo_item) for nome in [pedido.item_nome, pedido.solicitacao.item if pedido.solicitacao else ''])]
        if pedidos:
            item_nome = nome_item_completo(pedidos[0].item_nome or (pedidos[0].solicitacao.item if pedidos[0].solicitacao else termo_item))
            total = sum(Decimal(str(pedido.valor_total or 0)) for pedido in pedidos)
            if 'quando' in texto:
                resposta = f"A compra mais recente de '{item_nome}' foi emitida em {pedidos[0].data_emissao.strftime('%d/%m/%Y')}, no valor de {dinheiro(pedidos[0].valor_total)}."
            else:
                resposta = f"Foram encontrados {len(pedidos)} pedido(s) de '{item_nome}', totalizando {dinheiro(total)}."
            cards = [{"tipo": "PO", "id": f"PO-{500 + pedido.id}", "titulo": nome_item_completo(pedido.item_nome or (pedido.solicitacao.item if pedido.solicitacao else 'Pedido')), "subtitulo": f"{pedido.fornecedor} | {pedido.status}"} for pedido in pedidos[:5]]
        else:
            resposta = f"Não encontrei compras para o item '{nome_item_completo(termo_item) if termo_item else pergunta}'."
    elif termos_quantidade and not termos_rota:
        termo_item = valor_depois_de('para', 'item', 'produto')
        palavras_ignoradas = {'qual', 'foi', 'a', 'o', 'quantidade', 'qtd', 'solicitada', 'solicitado', 'do', 'da', 'de', 'para', 'item', 'produto', 'hoje', 'ontem'}
        termo_item = re.sub(r'\s+(?:nos?\s+)?ultimos?\s+\d+\s+mes(?:es)?', '', normalizar_texto(termo_item))
        termo_item = re.sub(r'\s+\d{1,2}/\d{1,2}\s+(?:a|ate)\s+\d{1,2}/\d{1,2}', '', termo_item)
        termo_item = ' '.join(palavra for palavra in normalizar_texto(termo_item).split() if palavra not in palavras_ignoradas).strip()
        consulta_solicitacoes = SolicitacaoCompra.query.filter(SolicitacaoCompra.item.ilike(f'%{termo_item}%'), SolicitacaoCompra.status != 'cancelado') if termo_item else None
        if consulta_solicitacoes is not None and inicio_periodo and fim_periodo:
            consulta_solicitacoes = consulta_solicitacoes.filter(SolicitacaoCompra.data_solicitacao >= inicio_periodo, SolicitacaoCompra.data_solicitacao <= fim_periodo)
        solicitacoes = consulta_solicitacoes.order_by(SolicitacaoCompra.id.desc()).all() if consulta_solicitacoes is not None else []
        if not solicitacoes and termo_item:
            consulta_candidatas = SolicitacaoCompra.query.filter(SolicitacaoCompra.status != 'cancelado')
            if inicio_periodo and fim_periodo:
                consulta_candidatas = consulta_candidatas.filter(SolicitacaoCompra.data_solicitacao >= inicio_periodo, SolicitacaoCompra.data_solicitacao <= fim_periodo)
            solicitacoes_candidatas = consulta_candidatas.order_by(SolicitacaoCompra.id.desc()).all()
            solicitacoes = [solicitacao for solicitacao in solicitacoes_candidatas if item_corresponde(solicitacao.item, termo_item) or any(difflib.SequenceMatcher(None, termo_item, palavra).ratio() >= 0.72 for palavra in normalizar_texto(solicitacao.item).split())]
        if solicitacoes:
            quantidade_total = sum(float(solicitacao.quantidade or 0) for solicitacao in solicitacoes)
            item_nome = nome_item_completo(solicitacoes[0].item)
            resposta = f"Foram solicitadas {quantidade_total:g} unidade(s) de '{item_nome}' em {len(solicitacoes)} solicitação(ões)."
            cards = [{"tipo": "SC", "id": f"SC-{1000 + solicitacao.id}", "titulo": nome_item_completo(solicitacao.item), "subtitulo": f"Quantidade: {solicitacao.quantidade:g} | {solicitacao.status}"} for solicitacao in solicitacoes[:8]]
        else:
            resposta = f"Foram solicitadas 0 unidade(s) de '{termo_item or pergunta}' no período informado."
    elif termos_rota:
        marcadores_rota = ('motorista', 'destino', 'fornecedor', 'endereco', 'endereço', 'rota')
        termo_rota = termo_especifico_rota(valor_depois_de(*marcadores_rota))
        filtros_rota = [
            RotaMotorista.motorista.ilike(f'%{termo_rota}%'),
            RotaMotorista.destino_fornecedor.ilike(f'%{termo_rota}%'),
            RotaMotorista.endereco.ilike(f'%{termo_rota}%'),
            RotaMotorista.observacoes.ilike(f'%{termo_rota}%'),
            RotaMotorista.po_ref.ilike(f'%{termo_rota}%')
        ]
        consulta_rotas = RotaMotorista.query.filter(db.or_(*filtros_rota)) if termo_rota else RotaMotorista.query
        if inicio_periodo and fim_periodo:
            consulta_rotas = consulta_rotas.filter(RotaMotorista.data_prevista >= inicio_periodo.strftime('%Y-%m-%d'), RotaMotorista.data_prevista <= fim_periodo.strftime('%Y-%m-%d'))
        elif 'hoje' in texto:
            consulta_rotas = consulta_rotas.filter(RotaMotorista.data_prevista == datetime.now(RECIFE_TZ).strftime('%Y-%m-%d'))
        elif 'amanha' in texto or 'amanhã' in texto:
            consulta_rotas = consulta_rotas.filter(RotaMotorista.data_prevista == (datetime.now(RECIFE_TZ) + timedelta(days=1)).strftime('%Y-%m-%d'))
        rotas = consulta_rotas.order_by(RotaMotorista.data_prevista.asc(), RotaMotorista.id.asc()).all()
        if rotas:
            rota = rotas[0]
            resposta = f"Encontrei {len(rotas)} rota(s). Próxima: {rota.destino_fornecedor}, em {rota.data_prevista}, com o motorista {rota.motorista}. Endereço: {rota.endereco or 'não informado'}. Status: {rota.status}. Observações: {rota.observacoes or 'nenhuma'} ."
            cards = [{"tipo": "ROTA", "id": rota.id, "titulo": rota.destino_fornecedor, "subtitulo": f"{rota.data_prevista} | {rota.motorista} | {rota.status}"} for rota in rotas[:8]]
        else:
            resposta = f"Não encontrei rota relacionada a '{termo_rota or pergunta}'."
    elif ('ultimo' in texto or 'ultima' in texto) and ('pedido' in texto or 'compra' in texto):
        marcadores_item = ('item', 'produto', 'de', 'da', 'do')
        termo_item = valor_depois_de(*marcadores_item)
        palavras_ignoradas = {'qual', 'foi', 'o', 'a', 'ultimo', 'ultima', 'pedido', 'pedidos', 'compra', 'compras', 'item', 'produto', 'ontem', 'hoje'}
        termo_item = ' '.join(palavra for palavra in normalizar_texto(termo_item).split() if palavra not in palavras_ignoradas).strip()
        consulta_pedidos = PedidoCompra.query.filter(PedidoCompra.status != 'cancelado')
        if inicio_periodo and fim_periodo:
            consulta_pedidos = consulta_pedidos.filter(PedidoCompra.data_emissao >= inicio_periodo, PedidoCompra.data_emissao <= fim_periodo)
        pedidos_candidatos = consulta_pedidos.order_by(PedidoCompra.data_emissao.desc()).all()
        pedidos = [pedido for pedido in pedidos_candidatos if termo_item and any(item_corresponde(nome, termo_item) for nome in [pedido.item_nome or '', pedido.solicitacao.item if pedido.solicitacao else ''])]
        if not pedidos and termo_item:
            pedidos = [pedido for pedido in pedidos_candidatos if any(item_corresponde(nome, termo_item) or difflib.SequenceMatcher(None, termo_item, palavra).ratio() >= 0.72 for nome in [pedido.item_nome or '', pedido.solicitacao.item if pedido.solicitacao else ''] for palavra in normalizar_texto(nome).split())]
        if pedidos:
            ultimo = pedidos[0]
            item_nome = ultimo.item_nome or (ultimo.solicitacao.item if ultimo.solicitacao else 'item da solicitação')
            resposta = f"O último pedido de '{item_nome}' foi emitido em {ultimo.data_emissao.strftime('%d/%m/%Y')} para o fornecedor '{ultimo.fornecedor}', no valor de {dinheiro(ultimo.valor_total)}."
            cards = [{"tipo": "PO", "id": f"PO-{500 + pedido.id}", "titulo": pedido.item_nome or (pedido.solicitacao.item if pedido.solicitacao else 'Pedido'), "subtitulo": f"{pedido.fornecedor} | {pedido.status}"} for pedido in pedidos[:5]]
        else:
            resposta = f"Não encontrei pedidos para o item '{termo_item or pergunta}'."
    elif 'fornecedor' in texto and ('item' in texto or 'produto' in texto or 'malha' in texto):
        termo = valor_depois_de('item', 'produto')
        item = item_cadastrado(termo)
        termo_descricao = item.descricao if item else termo
        solicitacoes = SolicitacaoCompra.query.filter(SolicitacaoCompra.item.ilike(f'%{termo_descricao}%')).order_by(SolicitacaoCompra.id.desc()).all()
        cotacoes = [cotacao for solicitacao in solicitacoes for cotacao in solicitacao.cotacoes]
        if cotacoes:
            cotacoes.sort(key=lambda cotacao: cotacao.valor_unitario)
            fornecedores = ', '.join(dict.fromkeys(cotacao.fornecedor for cotacao in cotacoes))
            resposta = f"Fornecedores encontrados para '{termo}': {fornecedores}. Melhor valor cotado: {cotacoes[0].fornecedor} por {dinheiro(cotacoes[0].valor_unitario)}."
            cards = [{"tipo": "SC", "id": f"SC-{1000 + solicitacao.id}", "titulo": solicitacao.item, "subtitulo": solicitacao.status} for solicitacao in solicitacoes[:5]]
        else:
            pedidos_candidatos = PedidoCompra.query.order_by(PedidoCompra.data_emissao.desc()).all()
            pedidos = [pedido for pedido in pedidos_candidatos if item_corresponde(pedido.item_nome, termo)]
            if pedidos:
                resposta = f"O fornecedor encontrado para '{termo}' foi {pedidos[0].fornecedor}, no valor de {dinheiro(pedidos[0].valor_total)}."
                cards = [{"tipo": "PO", "id": f"PO-{500 + pedido.id}", "titulo": pedido.item_nome or 'Pedido', "subtitulo": pedido.status} for pedido in pedidos[:5]]
            else:
                resposta = f"Não encontrei fornecedor relacionado ao item '{termo}'."
    elif 'fornecedor' in texto and ('valor' in texto or 'preco' in texto or 'preco' in texto or 'compra' in texto or 'pedido' in texto or 'ultimo' in texto):
        termo = valor_depois_de('fornecedor')
        consulta_pedidos = PedidoCompra.query.filter(PedidoCompra.fornecedor.ilike(f'%{termo}%'), PedidoCompra.status != 'cancelado')
        if inicio_periodo and fim_periodo:
            consulta_pedidos = consulta_pedidos.filter(PedidoCompra.data_emissao >= inicio_periodo, PedidoCompra.data_emissao <= fim_periodo)
        pedidos = consulta_pedidos.order_by(PedidoCompra.data_emissao.desc()).all()
        if pedidos:
            ultimo = pedidos[0]
            if 'quando' in texto or 'data' in texto:
                resposta = f"O último pedido para '{ultimo.fornecedor}' foi emitido em {ultimo.data_emissao.strftime('%d/%m/%Y')}, referente a {ultimo.item_nome or 'item da solicitação'}, no valor de {dinheiro(ultimo.valor_total)}."
            else:
                resposta = f"Última compra de '{ultimo.fornecedor}': {dinheiro(ultimo.valor_total)}, emitida em {ultimo.data_emissao.strftime('%d/%m/%Y')}, referente a {ultimo.item_nome or 'item da solicitação'}."
            cards = [{"tipo": "PO", "id": f"PO-{500 + pedido.id}", "titulo": pedido.item_nome or 'Pedido', "subtitulo": pedido.status} for pedido in pedidos[:5]]
        else:
            resposta = f"Não encontrei pedidos para o fornecedor '{termo}'."
    else:
        resposta = "Posso consultar rotas por motorista, destino ou endereço; pedidos previstos para chegar; fornecedor de um item; valor da última compra; ou data do último pedido por fornecedor."
    return jsonify({"resposta": resposta, "cards": cards}), 200

@api_bp.route('/dashboard/kpis', methods=['GET'])
@login_required
def get_dashboard_kpis():
    agora = datetime.utcnow()
    lead_times_externos = []

    for pedido in PedidoCompra.query.filter_by(status='entregue').all():
        if pedido.data_emissao and pedido.data_entrega:
            lead_times_externos.append(max(0, (pedido.data_entrega - pedido.data_emissao).total_seconds() / 86400))

    emissao_por_solicitacao = {}
    for solicitacao_id, data_emissao in db.session.query(
        PedidoCompra.solicitacao_id,
        db.func.min(PedidoCompra.data_emissao)
    ).filter(
        PedidoCompra.solicitacao_id.isnot(None),
        PedidoCompra.data_emissao.isnot(None)
    ).group_by(PedidoCompra.solicitacao_id).all():
        emissao_por_solicitacao[solicitacao_id] = data_emissao

    lead_times_internos = []
    for solicitacao in SolicitacaoCompra.query.filter(
        SolicitacaoCompra.status != 'cancelado',
        SolicitacaoCompra.data_solicitacao.isnot(None)
    ).all():
        fim = emissao_por_solicitacao.get(solicitacao.id) or agora
        lead_times_internos.append(max(
            0, (fim - solicitacao.data_solicitacao).total_seconds() / 86400
        ))

    def media(valores):
        return round(sum(valores) / len(valores), 2) if valores else None

    registros_ativos = SolicitacaoCompra.query.filter(SolicitacaoCompra.status != 'cancelado').all()
    registros_ativos += PedidoCompra.query.filter(PedidoCompra.status != 'cancelado').all()
    emergenciais = sum(
        1 for registro in registros_ativos
        if 'emergencia' in {tag.strip().lower() for tag in (registro.etiquetas or '').split(',') if tag.strip()}
    )

    return jsonify({
        'lead_time_externo_medio': media(lead_times_externos),
        'lead_time_interno_medio': media(lead_times_internos),
        'pedidos_com_lead_time_externo': len(lead_times_externos),
        'pedidos_com_lead_time_interno': len(lead_times_internos),
        'taxa_emergencial': round(emergenciais / len(registros_ativos) * 100, 2) if registros_ativos else 0
    }), 200

# ===============================================
# GESTÃO DE USUÁRIOS
# ===============================================
@api_bp.route('/niveis', methods=['GET'])
@login_required
def get_niveis():
    if current_user.perfil != 'admin':
        return jsonify({'erro': 'Acesso negado.'}), 403
    return jsonify({'paginas': [{'id': id_pagina, 'nome': nome} for id_pagina, nome in PAGINAS_SISTEMA], 'niveis': [nivel.to_dict() for nivel in NivelAcesso.query.order_by(NivelAcesso.nome).all()]}), 200

@api_bp.route('/niveis', methods=['POST'])
@login_required
def create_nivel():
    if current_user.perfil != 'admin':
        return jsonify({'erro': 'Acesso negado.'}), 403
    data = request.get_json(silent=True) or {}
    nome = str(data.get('nome', '')).strip().lower()
    permissoes = data.get('permissoes', [])
    if not nome or not re.fullmatch(r'[a-z0-9_-]{2,50}', nome):
        return jsonify({'erro': 'Informe um nome válido para o nível.'}), 400
    if not isinstance(permissoes, list) or any(pagina not in {item[0] for item in PAGINAS_SISTEMA} for pagina in permissoes):
        return jsonify({'erro': 'Uma ou mais páginas são inválidas.'}), 400
    if NivelAcesso.query.filter_by(nome=nome).first():
        return jsonify({'erro': 'Esse nível já existe.'}), 409
    nivel = NivelAcesso(nome=nome, permissoes=json.dumps(sorted(set(permissoes))))
    db.session.add(nivel)
    db.session.commit()
    return jsonify(nivel.to_dict()), 201

@api_bp.route('/niveis/<int:nivel_id>', methods=['PUT'])
@login_required
def update_nivel(nivel_id):
    if current_user.perfil != 'admin':
        return jsonify({'erro': 'Acesso negado.'}), 403
    nivel = NivelAcesso.query.get_or_404(nivel_id)
    data = request.get_json(silent=True) or {}
    permissoes = data.get('permissoes')
    if permissoes is not None:
        paginas_validas = {item[0] for item in PAGINAS_SISTEMA}
        if not isinstance(permissoes, list) or any(pagina not in paginas_validas for pagina in permissoes):
            return jsonify({'erro': 'Uma ou mais páginas são inválidas.'}), 400
        nivel.permissoes = json.dumps(sorted(set(permissoes)))
    if 'nome' in data:
        nome = str(data['nome']).strip().lower()
        if not re.fullmatch(r'[a-z0-9_-]{2,50}', nome):
            return jsonify({'erro': 'Informe um nome válido para o nível.'}), 400
        existente = NivelAcesso.query.filter(NivelAcesso.nome == nome, NivelAcesso.id != nivel.id).first()
        if existente:
            return jsonify({'erro': 'Esse nível já existe.'}), 409
        nivel.nome = nome
    db.session.commit()
    return jsonify(nivel.to_dict()), 200

@api_bp.route('/niveis/<int:nivel_id>', methods=['DELETE'])
@login_required
def delete_nivel(nivel_id):
    if current_user.perfil != 'admin':
        return jsonify({'erro': 'Acesso negado.'}), 403
    nivel = NivelAcesso.query.get_or_404(nivel_id)
    if Usuario.query.filter_by(perfil=nivel.nome).first():
        return jsonify({'erro': 'Não é possível excluir um nível usado por usuários.'}), 409
    db.session.delete(nivel)
    db.session.commit()
    return jsonify({'mensagem': 'Nível excluído.'}), 200

@api_bp.route('/usuarios', methods=['GET'])
@login_required
def get_usuarios():
    if current_user.perfil != 'admin':
        return jsonify({"erro": "Acesso negado."}), 403
    usuarios = Usuario.query.order_by(Usuario.id.asc()).all()
    return jsonify([u.to_dict() for u in usuarios]), 200

@api_bp.route('/me/senha', methods=['PUT'])
@login_required
def alterar_senha_propria():
    data = request.get_json(silent=True) or {}
    senha_atual = data.get('senha_atual')
    nova_senha = data.get('nova_senha')
    confirmacao = data.get('confirmacao')

    if not senha_atual or not nova_senha or not confirmacao:
        return jsonify({'erro': 'Preencha todos os campos de senha.'}), 400
    if not current_user.verificar_senha(senha_atual):
        return jsonify({'erro': 'A senha atual está incorreta.'}), 400
    if len(nova_senha) < 6:
        return jsonify({'erro': 'A nova senha deve ter pelo menos 6 caracteres.'}), 400
    if nova_senha != confirmacao:
        return jsonify({'erro': 'A confirmação da nova senha não confere.'}), 400
    if senha_atual == nova_senha:
        return jsonify({'erro': 'A nova senha deve ser diferente da senha atual.'}), 400

    current_user.set_senha(nova_senha)
    db.session.commit()
    return jsonify({'mensagem': 'Senha alterada com sucesso.'}), 200

@api_bp.route('/usuarios', methods=['POST'])
@login_required
def create_usuario():
    if current_user.perfil != 'admin':
        return jsonify({"erro": "Acesso negado."}), 403
    data = request.get_json()
    if not data or not data.get('email') or not data.get('senha') or not data.get('nome'):
        return jsonify({"erro": "Preencha todos os campos obrigatórios."}), 400

    email = data['email'].strip().lower()
    perfil = str(data.get('perfil', 'solicitante')).strip().lower()
    if not NivelAcesso.query.filter_by(nome=perfil).first():
        return jsonify({'erro': 'O nível informado não existe.'}), 400
    if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', email):
        return jsonify({"erro": "Informe um endereço de e-mail válido."}), 400
    if Usuario.query.filter_by(email=email).first():
        return jsonify({"erro": "E-mail já cadastrado."}), 400
        
    try:
        token, token_hash, expira_em = gerar_token_confirmacao()
        novo = Usuario(
            nome=data['nome'],
            email=email,
            perfil=perfil,
            email_confirmado=False,
            email_confirmacao_token_hash=token_hash,
            email_confirmacao_expira_em=expira_em
        )
        novo.set_senha(data['senha'])
        db.session.add(novo)
        enviar_email_confirmacao(novo.email, novo.nome, token)
        db.session.commit()
        return jsonify({"mensagem": "Usuário criado. Um link de confirmação foi enviado ao e-mail informado."}), 201
    except RuntimeError as e:
        db.session.rollback()
        return jsonify({"erro": str(e)}), 503
    except Exception as e:
        db.session.rollback()
        return jsonify({"erro": "Erro interno", "detalhes": str(e)}), 500

@api_bp.route('/usuarios/<int:id>', methods=['PUT'])
@login_required
def update_usuario(id):
    if current_user.perfil != 'admin':
        return jsonify({"erro": "Acesso negado."}), 403
    u = Usuario.query.get_or_404(id)
    data = request.get_json()
    try:
        if 'nome' in data: u.nome = data['nome']
        if u.email.lower() == USUARIO_ADMIN_PROTEGIDO:
            if 'email' in data and str(data['email']).strip().lower() != USUARIO_ADMIN_PROTEGIDO:
                return jsonify({'erro': 'O e-mail do administrador protegido não pode ser alterado.'}), 400
            u.email = USUARIO_ADMIN_PROTEGIDO
            u.perfil = 'admin'
            u.email_confirmado = True
        elif 'email' in data:
            u.email = data['email']
        if 'perfil' in data and u.email.lower() != USUARIO_ADMIN_PROTEGIDO:
            perfil = str(data['perfil']).strip().lower()
            if not NivelAcesso.query.filter_by(nome=perfil).first():
                return jsonify({'erro': 'O nível informado não existe.'}), 400
            u.perfil = perfil
        if 'senha' in data and data['senha'].strip():
            u.set_senha(data['senha'])
        db.session.commit()
        return jsonify(u.to_dict()), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"erro": "Erro ao atualizar", "detalhes": str(e)}), 500

@api_bp.route('/usuarios/<int:id>', methods=['DELETE'])
@login_required
def delete_usuario(id):
    if current_user.perfil != 'admin':
        return jsonify({"erro": "Acesso negado."}), 403
    if current_user.id == id:
        return jsonify({"erro": "Você não pode excluir sua própria conta logada."}), 400
    u = Usuario.query.get_or_404(id)
    if u.email.lower() == USUARIO_ADMIN_PROTEGIDO:
        return jsonify({"erro": "O administrador protegido não pode ser excluído."}), 403
    try:
        db.session.delete(u)
        db.session.commit()
        return jsonify({"mensagem": "Usuário excluído com sucesso."}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"erro": "Erro ao excluir", "detalhes": str(e)}), 500

# ===============================================
# SOLICITAÇÕES DE COMPRA
# ===============================================
@api_bp.route('/solicitacoes', methods=['GET'])
@login_required
def get_solicitacoes():
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 50, type=int)
    consulta = SolicitacaoCompra.query
    if current_user.perfil not in ('comprador', 'admin'):
        consulta = consulta.filter_by(usuario_id=current_user.id)
    paginated = consulta.order_by(SolicitacaoCompra.id.desc()).paginate(page=page, per_page=per_page, error_out=False)
    return jsonify({
        "items": [sc.to_dict() for sc in paginated.items],
        "has_next": paginated.has_next,
        "page": paginated.page
    }), 200

@api_bp.route('/solicitacoes', methods=['POST'])
@login_required
def create_solicitacao():
    data = request.get_json() or {}
    if not data:
        return jsonify({"erro": "Requisição sem dados JSON"}), 400

    setor = resolver_setor_solicitante(data.get('setor'), current_user)

    itens_payload = normalizar_lista_itens(data.get('itens'))
    if not itens_payload and ('item' in data or 'quantidade' in data):
        itens_payload = [{'item': data.get('item'), 'quantidade': data.get('quantidade', 1)}]
    if not itens_payload:
        return jsonify({"erro": "Informe ao menos um item para a solicitação."}), 400

    numero_pedido_sap = str(data.get('numero_pedido_sap', '') or '').strip()[:50]
    criadas = []

    try:
        itens_validos = []
        itens_cadastrados = {
            normalizar_texto(valor): item.id
            for item in Item.query.all()
            for valor in (item.codigo, item.descricao)
            if normalizar_texto(valor)
        }
        solicitacoes_existentes = []
        if numero_pedido_sap:
            solicitacoes_existentes = SolicitacaoCompra.query.filter_by(
                setor_solicitante=setor
            ).all()
            solicitacoes_existentes = [
                solicitacao for solicitacao in solicitacoes_existentes
                if normalizar_texto(solicitacao.numero_pedido_sap) == normalizar_texto(numero_pedido_sap)
            ]

        for item_payload in itens_payload:
            item_nome = str(item_payload.get('item') or '').strip()
            if not item_nome:
                return jsonify({"erro": "Um dos itens da solicitação está sem descrição."}), 400
            quantidade = float(item_payload.get('quantidade', 1) or 1)
            if quantidade <= 0:
                return jsonify({"erro": "A quantidade deve ser maior que zero."}), 400
            item_chave = normalizar_texto(item_nome)
            item_id = itens_cadastrados.get(item_chave)
            duplicada = next((solicitacao for solicitacao in solicitacoes_existentes
                             if (itens_cadastrados.get(normalizar_texto(solicitacao.item)) == item_id
                                 and item_id is not None)
                             or normalizar_texto(solicitacao.item) == item_chave), None)
            if duplicada:
                return jsonify({"erro": f"Já existe uma solicitação para este item, setor e pedido SAP (SC-{1000 + duplicada.id})."}), 409

            item_cadastrado_ref = item_cadastrado(item_nome)
            itens_validos.append({
                "codigo": item_cadastrado_ref.codigo if item_cadastrado_ref else "",
                "item": item_nome,
                "quantidade": quantidade,
                "status": "pendente"
            })

        item_descricao = resumir_itens_solicitacao(itens_validos)
        quantidade_total = sum(float(item['quantidade']) for item in itens_validos)

        nova_sc = SolicitacaoCompra(
            item=item_descricao,
            quantidade=quantidade_total,
            itens_detalhados=json.dumps(itens_validos, ensure_ascii=False),
            setor_solicitante=setor,
            numero_pedido_sap=numero_pedido_sap,
            status='pendente',
            usuario_id=current_user.id
        )
        db.session.add(nova_sc)
        db.session.flush()
        db.session.add(Comentario(tipo_ref='SC', ref_id=nova_sc.id, texto=f"Solicitação criada por {current_user.nome}."))
        notificar_nova_solicitacao(nova_sc)
        criadas.append(nova_sc)

        db.session.commit()
        resposta = [sc.to_dict() for sc in criadas]
        return jsonify(resposta[0] if len(resposta) == 1 else {"solicitacoes": resposta}), 201
    except (ValueError, TypeError):
        db.session.rollback()
        return jsonify({"erro": "Quantidade com formato numérico inválido"}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({"erro": "Erro interno", "detalhes": str(e)}), 500

@api_bp.route('/notificacoes', methods=['GET'])
@login_required
def get_notificacoes():
    sincronizar_notificacoes_solicitacoes_recentes()
    notificacoes = Notificacao.query.filter_by(usuario_id=current_user.id, lida=False).order_by(Notificacao.id.desc()).limit(10).all()
    return jsonify([notificacao.to_dict() for notificacao in notificacoes]), 200

@api_bp.route('/notificacoes/<int:id>/ler', methods=['PUT'])
@login_required
def marcar_notificacao_lida(id):
    notificacao = Notificacao.query.filter_by(id=id, usuario_id=current_user.id).first_or_404()
    notificacao.lida = True
    db.session.commit()
    return jsonify({'mensagem': 'Notificação marcada como lida.'}), 200

@api_bp.route('/solicitacoes/<int:id>', methods=['PUT'])
@login_required
def editar_solicitacao(id):
    data = request.get_json()
    sc = SolicitacaoCompra.query.get_or_404(id)
    if current_user.perfil not in ('comprador', 'admin', 'gerente') and sc.usuario_id != current_user.id:
        return jsonify({"erro": "Você só pode editar suas próprias solicitações."}), 403
    try:
        itens_payload = normalizar_lista_itens(data.get('itens')) if 'itens' in data else []
        if itens_payload:
            itens_validos = []
            itens_originais = data.get('itens') if isinstance(data.get('itens'), list) else []
            for indice, item_payload in enumerate(itens_payload):
                item_nome = str(item_payload.get('item') or '').strip()
                quantidade_item = float(item_payload.get('quantidade', 0) or 0)
                if not item_nome or quantidade_item <= 0:
                    return jsonify({"erro": "Todos os itens devem ter descrição e quantidade maior que zero."}), 400
                item_original = itens_originais[indice] if indice < len(itens_originais) and isinstance(itens_originais[indice], dict) else {}
                cadastro = item_cadastrado(item_nome)
                itens_validos.append({
                    'codigo': item_original.get('codigo') or (cadastro.codigo if cadastro else ''),
                    'item': item_nome,
                    'quantidade': quantidade_item,
                    'status': item_original.get('status') or 'pendente'
                })
            quantidade = sum(item['quantidade'] for item in itens_validos)
        else:
            itens_validos = None
            quantidade = float(data['quantidade']) if 'quantidade' in data else sc.quantidade
        if quantidade <= 0:
            return jsonify({"erro": "A quantidade deve ser maior que zero."}), 400
        item_valor = data.get('item', sc.item)
        setor_valor = resolver_setor_solicitante(data.get('setor', sc.setor_solicitante), current_user)
        sap_valor = str(data.get('numero_pedido_sap', sc.numero_pedido_sap) or '').strip()[:50]
        duplicada = solicitacao_duplicada(item_valor, setor_valor, sap_valor, ignorar_id=id)
        if duplicada:
            return jsonify({"erro": f"Já existe uma solicitação para este item, setor e pedido SAP (SC-{1000 + duplicada.id})."}), 409
        sc.quantidade = quantidade
        if itens_validos is not None:
            sc.item = resumir_itens_solicitacao(itens_validos)
            sc.itens_detalhados = json.dumps(itens_validos, ensure_ascii=False)
        if 'item' in data:
            sc.item = str(data['item']).strip()
        sc.setor_solicitante = setor_valor
        if 'numero_pedido_sap' in data:
            sc.numero_pedido_sap = sap_valor
        db.session.add(Comentario(tipo_ref='SC', ref_id=id, texto=f"Solicitação editada por {current_user.nome}."))
        db.session.commit()
        return jsonify(sc.to_dict()), 200
    except ValueError:
        return jsonify({"erro": "Quantidade inválida"}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({"erro": "Erro interno", "detalhes": str(e)}), 500

@api_bp.route('/solicitacoes/<int:id>/status', methods=['PUT'])
@login_required
def atualizar_status_solicitacao(id):
    data = request.get_json()
    if not data or 'status' not in data:
        return jsonify({"erro": "O campo 'status' é obrigatório."}), 400
    if current_user.perfil not in ('comprador', 'admin', 'gerente'):
        return jsonify({"erro": "Acesso negado."}), 403
    status = str(data.get('status') or '').strip().lower()
    if status not in ('pendente', 'cotacao', 'cancelado'):
        return jsonify({"erro": "Status de solicitação inválido."}), 400
    sc = SolicitacaoCompra.query.get_or_404(id)
    try:
        antigo = sc.status
        sc.status = status
        db.session.add(Comentario(tipo_ref='SC', ref_id=id, texto=f"Status alterado de '{antigo}' para '{sc.status}' por {current_user.nome}."))
        db.session.commit()
        return jsonify(sc.to_dict()), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"erro": "Falha", "detalhes": str(e)}), 500

@api_bp.route('/solicitacoes/<int:id>/aprovar', methods=['PUT'])
@login_required
def aprovar_solicitacao(id):
    if current_user.perfil in ['solicitante', 'estoque']:
        return jsonify({"erro": "Acesso negado."}), 403

    data = request.get_json()
    if not data or 'cotacao_id' not in data:
        return jsonify({"erro": "O campo 'cotacao_id' é obrigatório."}), 400
    
    try:
        novo_pedido = aprovar_solicitacao_service(id, data['cotacao_id'])
        db.session.add(Comentario(tipo_ref='SC', ref_id=id, texto=f"Cotação ID {data['cotacao_id']} aprovada. Pedido PO-{500 + novo_pedido.id} gerado por {current_user.nome}."))
        db.session.add(Comentario(tipo_ref='PO', ref_id=novo_pedido.id, texto=f"Pedido gerado a partir da SC-{1000 + id} por {current_user.nome}."))
        db.session.commit()
        return jsonify({"mensagem": "Pedido gerado!", "po": novo_pedido.to_dict()}), 200
    except ValueError as e:
        db.session.rollback()
        status_code = 409 if 'já foi aprovada' in str(e) else 400
        return jsonify({"erro": str(e)}), status_code
    except Exception as e:
        return jsonify({"erro": "Falha ao aprovar solicitação", "detalhes": str(e)}), 500

# ===============================================
# COTAÇÕES
# ===============================================
@api_bp.route('/cotacoes/<int:sc_db_id>', methods=['GET'])
@login_required
def get_cotacoes(sc_db_id):
    cotacoes = Cotacao.query.filter_by(solicitacao_id=sc_db_id).order_by(Cotacao.valor_total.asc()).all()
    return jsonify([c.to_dict() for c in cotacoes]), 200

@api_bp.route('/rastreabilidade/<tipo>/<int:id>', methods=['GET'])
@login_required
def get_rastreabilidade(tipo, id):
    eventos = []

    def extrair_usuario(texto):
        texto = str(texto or '').strip()
        correspondencia = re.match(r'^([^:]+):\s', texto)
        if correspondencia:
            return correspondencia.group(1).strip()
        correspondencia = re.search(r'\b(?:por|Por|POR|Registrado por)\s+([^\.]+)', texto)
        return correspondencia.group(1).strip() if correspondencia else 'Usuário não identificado'

    def adicionar(etapa, titulo, status, data, detalhe='', ref_tipo=None, ref_id=None, usuario='Usuário não identificado'):
        eventos.append({
            'etapa': etapa, 'titulo': titulo, 'status': status or '',
            'data': data.isoformat() if data else None, 'detalhe': detalhe,
            'tipo': ref_tipo, 'id': ref_id, 'usuario': usuario
        })

    if tipo == 'SC':
        solicitacao = SolicitacaoCompra.query.get_or_404(id)
        adicionar('Solicitação', f'SC-{1000 + solicitacao.id}', solicitacao.status, solicitacao.data_solicitacao,
                  f'{solicitacao.item} | Quantidade: {solicitacao.quantidade}', 'SC', solicitacao.id)
        for cotacao in sorted(solicitacao.cotacoes, key=lambda registro: registro.id):
            adicionar('Cotação', f'Cotação #{cotacao.id}', 'apresentada', cotacao.data_cotacao,
                      f'{cotacao.fornecedor} | R$ {cotacao.valor_unitario} | Prazo: {cotacao.prazo_entrega}', 'COT', cotacao.id)
        for pedido in sorted(solicitacao.pedidos, key=lambda registro: registro.id):
            adicionar('Pedido de compra', f'PO-{500 + pedido.id}', pedido.status, pedido.data_emissao,
                      f'{pedido.fornecedor} | Valor: R$ {pedido.valor_total}', 'PO', pedido.id)
    elif tipo == 'PO':
        pedido = PedidoCompra.query.get_or_404(id)
        if pedido.solicitacao:
            solicitacao = pedido.solicitacao
            adicionar('Solicitação', f'SC-{1000 + solicitacao.id}', solicitacao.status, solicitacao.data_solicitacao,
                      f'{solicitacao.item} | Quantidade: {solicitacao.quantidade}', 'SC', solicitacao.id)
            cotacao = next((registro for registro in solicitacao.cotacoes if registro.fornecedor == pedido.fornecedor), None)
            if cotacao:
                adicionar('Cotação aprovada', f'Cotação #{cotacao.id}', 'aprovada', cotacao.data_cotacao,
                          f'{cotacao.fornecedor} | R$ {cotacao.valor_unitario}', 'COT', cotacao.id)
        adicionar('Pedido de compra', f'PO-{500 + pedido.id}', pedido.status, pedido.data_emissao,
                  f'{pedido.fornecedor} | Valor: R$ {pedido.valor_total}', 'PO', pedido.id)
        if pedido.data_entrega:
            adicionar('Recebimento', 'Pedido recebido', 'entregue', pedido.data_entrega,
                      f'Entrega registrada em {pedido.data_entrega.strftime("%d/%m/%Y")}', 'PO', pedido.id)
    elif tipo == 'PEDIDO_MRP':
        pedido = PedidoMRP.query.get_or_404(id)
        adicionar('Pedido MRP', f'Pedido #{pedido.id}', 'incluído', pedido.data_criacao,
                  f'{pedido.produto} | Cliente: {pedido.cliente} | Consumo: {pedido.consumo_total}', 'PEDIDO_MRP', pedido.id)
        for compra in sorted(pedido.compras, key=lambda registro: registro.id):
            adicionar('Compra', f'Compra #{compra.id}', 'recebida' if compra.quantidade_recebida >= compra.quantidade else 'parcial',
                      compra.data_criacao, f'{compra.fornecedor} | Quantidade: {compra.quantidade}', 'COMPRA_MRP', compra.id)
            if compra.data_recebimento:
                adicionar('Recebimento', f'Compra #{compra.id} recebida', 'recebido', None,
                          f'Quantidade recebida: {compra.quantidade_recebida}', 'COMPRA_MRP', compra.id)
    elif tipo == 'COMPRA_MRP':
        compra = CompraMRP.query.get_or_404(id)
        for pedido in sorted(compra.pedidos, key=lambda registro: registro.id):
            adicionar('Pedido MRP', f'Pedido #{pedido.id}', 'incluído', pedido.data_criacao,
                      f'{pedido.produto} | Cliente: {pedido.cliente}', 'PEDIDO_MRP', pedido.id)
        adicionar('Compra', f'Compra #{compra.id}', 'recebida' if compra.quantidade_recebida >= compra.quantidade else 'parcial',
                  compra.data_criacao, f'{compra.fornecedor} | Quantidade: {compra.quantidade}', 'COMPRA_MRP', compra.id)
        if compra.data_recebimento:
            adicionar('Recebimento', 'Compra recebida', 'recebido', None,
                      f'Quantidade recebida: {compra.quantidade_recebida}', 'COMPRA_MRP', compra.id)
    else:
        return jsonify({'erro': 'Tipo de rastreabilidade inválido.'}), 400

    referencias = {(evento['tipo'], evento['id']) for evento in eventos if evento['tipo'] and evento['id']}
    for tipo_ref, ref_id in referencias:
        comentarios = Comentario.query.filter_by(tipo_ref=tipo_ref, ref_id=ref_id).order_by(Comentario.data_criacao.asc()).all()
        for comentario in comentarios:
            adicionar('Histórico', 'Registro de atividade', 'registrado', comentario.data_criacao, comentario.texto, tipo_ref, ref_id, extrair_usuario(comentario.texto))
    eventos.sort(key=lambda evento: evento['data'] or '')
    return jsonify({'tipo': tipo, 'id': id, 'eventos': eventos}), 200

@api_bp.route('/cotacoes', methods=['POST'])
@login_required
def create_cotacao():
    if current_user.perfil in ['solicitante', 'estoque']:
        return jsonify({"erro": "Acesso negado."}), 403

    data = request.get_json() or {}
    try:
        sc = SolicitacaoCompra.query.get_or_404(data['sc_db_id'])
        itens_recebidos = data.get('itens') or []
        if not itens_recebidos:
            itens_recebidos = [{'item': sc.item, 'quantidade': sc.quantidade, 'unidade': 'UN',
                                'valor_unitario': data.get('valor_unitario')}]
        itens_cotacao = []
        itens_ignorados = set()
        for item_payload in itens_recebidos:
            item_nome = str(item_payload.get('item') or '').strip()
            if not item_nome:
                return jsonify({"erro": "Um item da solicitação está sem descrição."}), 400
            if item_payload.get('nao_comprar') is True:
                itens_ignorados.add(item_nome.casefold())
                continue
            quantidade_raw = str(item_payload.get('quantidade') or '').strip()
            valor_item_raw = str(item_payload.get('valor_unitario') or '').strip()
            if not quantidade_raw or not valor_item_raw:
                return jsonify({"erro": "Preencha quantidade e preço unitário para cada item cotado ou marque 'Não comprar'."}), 400
            quantidade = Decimal(quantidade_raw or '0')
            valor_item = Decimal(valor_item_raw or '0')
            if quantidade <= 0 or valor_item <= 0:
                return jsonify({"erro": "Preencha quantidade e preço unitário para cada item cotado."}), 400
            nome_fornecedor = str(item_payload.get('fornecedor') or data.get('fornecedor') or '').strip()
            prazo_entrega = str(item_payload.get('prazo_entrega') or data.get('prazo_entrega') or '').strip()
            condicao_pgto = str(item_payload.get('condicao_pgto') or data.get('condicao_pgto') or '').strip()
            if not nome_fornecedor or not prazo_entrega or not condicao_pgto:
                return jsonify({"erro": "Preencha fornecedor, prazo de entrega e condição de pagamento para cada item."}), 400
            forn_cadastrado = Fornecedor.query.filter(
                db.or_(Fornecedor.razao_social.ilike(nome_fornecedor), Fornecedor.cnpj == nome_fornecedor)
            ).first()
            if not forn_cadastrado:
                return jsonify({"erro": f"Fornecedor não homologado: {nome_fornecedor}. Cadastre-o na aba de Fornecedores."}), 400
            total_item = quantidade * valor_item
            itens_cotacao.append({
                'item': item_nome, 'quantidade': float(quantidade),
                'unidade': str(item_payload.get('unidade') or 'UN').strip(),
                'fornecedor': forn_cadastrado.razao_social,
                'prazo_entrega': prazo_entrega, 'condicao_pgto': condicao_pgto,
                'valor_unitario_raw': float(valor_item), 'valor_total_raw': float(total_item),
                'valor_unitario': f"R$ {valor_item:,.4f}".replace(',', 'X').replace('.', ',').replace('X', '.'),
                'valor_total': f"R$ {total_item:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')
            })
        if itens_ignorados:
            try:
                itens_solicitacao = json.loads(sc.itens_detalhados or '[]')
            except (TypeError, ValueError):
                itens_solicitacao = []
            if not isinstance(itens_solicitacao, list) or not itens_solicitacao:
                itens_solicitacao = normalizar_lista_itens(sc.item)
                if len(itens_solicitacao) == 1:
                    itens_solicitacao[0]['quantidade'] = float(sc.quantidade or 0)
            encontrados = set()
            for item in itens_solicitacao:
                if not isinstance(item, dict):
                    continue
                chave_item = str(item.get('item') or '').strip().casefold()
                if chave_item not in itens_ignorados:
                    continue
                if item.get('status', 'pendente') != 'pendente':
                    return jsonify({"erro": f"O item {item.get('item')} não está mais pendente."}), 409
                
                item['status'] = 'nao_comprar'
                encontrados.add(chave_item)
            if encontrados != itens_ignorados:
                return jsonify({"erro": "Um ou mais itens marcados para não comprar não pertencem a esta solicitação."}), 400
            sc.itens_detalhados = json.dumps(itens_solicitacao, ensure_ascii=False)
            db.session.add(Comentario(
                tipo_ref='SC', ref_id=sc.id,
                texto=f"Itens marcados como 'não comprar' por {current_user.nome}."
            ))
        if not itens_cotacao and not itens_ignorados:
            return jsonify({"erro": "Informe pelo menos um item cotado."}), 400
        cotacoes_criadas = []
        grupos = {}
        for item in itens_cotacao:
            chave = (item['fornecedor'], item['prazo_entrega'], item['condicao_pgto'])
            grupos.setdefault(chave, []).append(item)
        for (fornecedor, prazo_entrega, condicao_pgto), itens_grupo in grupos.items():
            valor_unitario = Decimal(str(itens_grupo[0]['valor_unitario_raw']))
            valor_total = sum(Decimal(str(item['valor_total_raw'])) for item in itens_grupo)
            cotacao_existente = Cotacao.query.filter_by(
                solicitacao_id=data['sc_db_id'], fornecedor=fornecedor,
                prazo_entrega=prazo_entrega, condicao_pgto=condicao_pgto
            ).first()
            if cotacao_existente:
                return jsonify({"erro": f"Esta cotação já foi cadastrada para a solicitação e fornecedor {fornecedor}."}), 409
            nova_cotacao = Cotacao(
                solicitacao_id=data['sc_db_id'], fornecedor=fornecedor, valor_unitario=valor_unitario,
                itens_cotacao=json.dumps(itens_grupo, ensure_ascii=False), valor_total=valor_total,
                prazo_entrega=prazo_entrega, condicao_pgto=condicao_pgto
            )
            db.session.add(nova_cotacao)
            cotacoes_criadas.append(nova_cotacao)
            db.session.add(Comentario(tipo_ref='SC', ref_id=data['sc_db_id'], texto=f"Nova cotação registrada: {fornecedor} - total R$ {valor_total} por {current_user.nome}."))
        db.session.commit()
        return jsonify([cotacao.to_dict() for cotacao in cotacoes_criadas]), 201
    except (InvalidOperation, ValueError):
        return jsonify({"erro": "Valor unitário inválido"}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({"erro": "Erro interno", "detalhes": str(e)}), 500

# ===============================================
# PEDIDOS DE COMPRA
# ===============================================
@api_bp.route('/pedidos', methods=['GET'])
@login_required
def get_pedidos():
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 50, type=int)
    paginated = PedidoCompra.query.order_by(PedidoCompra.id.desc()).paginate(page=page, per_page=per_page, error_out=False)
    return jsonify({
        "items": [p.to_dict() for p in paginated.items],
        "has_next": paginated.has_next,
        "page": paginated.page
    }), 200

@api_bp.route('/comercial/pedidos', methods=['GET'])
@login_required
def get_pedidos_comerciais():
    if current_user.perfil not in ('comercial', 'admin'):
        return jsonify({'erro': 'Acesso negado.'}), 403
    pedidos = PedidoComercial.query.order_by(PedidoComercial.data_pedido.desc(), PedidoComercial.id.desc()).all()
    return jsonify([pedido.to_dict() for pedido in pedidos]), 200

@api_bp.route('/comercial/pedidos', methods=['POST'])
@login_required
def create_pedido_comercial():
    if current_user.perfil not in ('comercial', 'admin'):
        return jsonify({'erro': 'Acesso negado.'}), 403
    dados = request.form
    cliente = str(dados.get('cliente', '')).strip()
    pedido_sap = str(dados.get('pedido_sap', '')).strip()
    data_pedido = str(dados.get('data_pedido', '')).strip()
    observacoes = str(dados.get('observacoes', '')).strip()
    resumo = str(dados.get('resumo', '')).strip()
    valor_total_raw = str(dados.get('valor_total', '')).strip()
    valor_total = parse_preco(valor_total_raw) if valor_total_raw else None
    itens_payload = []
    for chave, valor in list(dados.items()):
        if chave.startswith('itens[') and '][produto]' in chave:
            indice = chave.split('[')[1].split(']')[0]
            produto = str(dados.get(f'itens[{indice}][produto]', '')).strip()
            quantidade = str(dados.get(f'itens[{indice}][quantidade]', '')).strip()
            valor_item = str(dados.get(f'itens[{indice}][valor]', '')).strip()
            observacao_item = str(dados.get(f'itens[{indice}][observacao]', '')).strip()
            if produto and quantidade and valor_item:
                itens_payload.append({
                    'produto': produto,
                    'quantidade': quantidade,
                    'valor': valor_item,
                    'observacao': observacao_item
                })
    if not cliente or not pedido_sap or not data_pedido or not itens_payload:
        return jsonify({'erro': 'Preencha cliente, pedido SAP, data e pelo menos um produto do pedido comercial.'}), 400
    try:
        data_pedido_dt = datetime.strptime(data_pedido, '%Y-%m-%d').date()
    except ValueError:
        return jsonify({'erro': 'Data do pedido inválida.'}), 400
    total_itens = Decimal('0')
    for item_data in itens_payload:
        try:
            quantidade = float(item_data['quantidade'])
        except (TypeError, ValueError):
            return jsonify({'erro': f'Quantidade do produto {item_data.get("produto", "#")} inválida.'}), 400
        if quantidade <= 0:
            return jsonify({'erro': 'A quantidade do produto deve ser maior que zero.'}), 400
        try:
            valor_item = parse_preco(item_data['valor'])
        except Exception:
            return jsonify({'erro': f'Valor do produto {item_data.get("produto", "#")} inválido.'}), 400
        if valor_item <= 0:
            return jsonify({'erro': f'O valor do produto {item_data.get("produto", "#")} deve ser maior que zero.'}), 400
        total_itens += Decimal(str(quantidade)) * valor_item
    if valor_total is None:
        valor_total = total_itens
    if valor_total <= 0:
        return jsonify({'erro': 'O valor total do pedido deve ser maior que zero.'}), 400
    if not resumo:
        resumo = f"Pedido {pedido_sap} para {cliente} — " + '; '.join(f"{item['produto']} ({item['quantidade']})" for item in itens_payload) + f" — total {valor_total:.2f}"
    pedido = PedidoComercial(
        cliente=cliente,
        data_pedido=data_pedido_dt,
        pedido_sap=pedido_sap[:50],
        valor_total=valor_total,
        observacoes=observacoes,
        resumo=resumo[:1000]
    )
    db.session.add(pedido)
    db.session.flush()
    for indice, item_data in enumerate(itens_payload):
        quantidade = float(item_data['quantidade'])
        valor_item = parse_preco(item_data['valor'])
        imagem = request.files.get(f'itens[{indice}][imagem]')
        imagem_filename = None
        if imagem and imagem.filename:
            extensao = os.path.splitext(secure_filename(imagem.filename))[1].lower()
            if extensao not in {'.png', '.jpg', '.jpeg', '.webp'}:
                return jsonify({'erro': 'A imagem deve estar em PNG, JPG, JPEG ou WEBP.'}), 400
            imagem_filename = f'{uuid.uuid4().hex}{extensao}'
            imagem.save(os.path.join(COMERCIAL_UPLOAD_FOLDER, imagem_filename))
        db.session.add(PedidoComercialItem(
            pedido_id=pedido.id,
            produto=str(item_data['produto']).strip()[:150],
            quantidade=quantidade,
            valor=valor_item,
            observacao=str(item_data.get('observacao', '')).strip()[:1000],
            imagem_filename=imagem_filename
        ))
    db.session.commit()
    return jsonify(pedido.to_dict()), 201

@api_bp.route('/comercial/pedidos/<int:pedido_id>', methods=['PUT'])
@login_required
def update_pedido_comercial(pedido_id):
    if current_user.perfil not in ('comercial', 'admin'):
        return jsonify({'erro': 'Acesso negado.'}), 403
    pedido = PedidoComercial.query.get_or_404(pedido_id)
    dados = request.form
    cliente = str(dados.get('cliente', '')).strip()
    pedido_sap = str(dados.get('pedido_sap', '')).strip()
    data_pedido = str(dados.get('data_pedido', '')).strip()
    observacoes = str(dados.get('observacoes', '')).strip()
    resumo = str(dados.get('resumo', '')).strip()
    valor_total_raw = str(dados.get('valor_total', '')).strip()
    valor_total = parse_preco(valor_total_raw) if valor_total_raw else None
    if not cliente or not pedido_sap or not data_pedido:
        return jsonify({'erro': 'Preencha cliente, pedido SAP e data do pedido.'}), 400
    try:
        pedido.data_pedido = datetime.strptime(data_pedido, '%Y-%m-%d').date()
    except ValueError:
        return jsonify({'erro': 'Data do pedido inválida.'}), 400
    itens_payload = []
    for chave, valor in list(dados.items()):
        if chave.startswith('itens[') and '][produto]' in chave:
            indice = chave.split('[')[1].split(']')[0]
            produto = str(dados.get(f'itens[{indice}][produto]', '')).strip()
            quantidade = str(dados.get(f'itens[{indice}][quantidade]', '')).strip()
            valor_item = str(dados.get(f'itens[{indice}][valor]', '')).strip()
            observacao_item = str(dados.get(f'itens[{indice}][observacao]', '')).strip()
            if not produto or not quantidade or not valor_item:
                continue
            itens_payload.append({
                'produto': produto,
                'quantidade': quantidade,
                'valor': valor_item,
                'observacao': observacao_item
            })
    if not itens_payload:
        return jsonify({'erro': 'O pedido deve conter pelo menos um produto.'}), 400
    total_itens = Decimal('0')
    for item_data in itens_payload:
        try:
            quantidade_num = float(item_data['quantidade'])
        except ValueError:
            return jsonify({'erro': 'Quantidade de produto inválida.'}), 400
        if quantidade_num <= 0:
            return jsonify({'erro': 'A quantidade do produto deve ser maior que zero.'}), 400
        try:
            valor_item = parse_preco(item_data['valor'])
        except Exception:
            return jsonify({'erro': f'Valor do produto {item_data.get("produto", "#")} inválido.'}), 400
        if valor_item <= 0:
            return jsonify({'erro': f'O valor do produto {item_data.get("produto", "#")} deve ser maior que zero.'}), 400
        total_itens += Decimal(str(quantidade_num)) * valor_item
    pedido.cliente = cliente
    pedido.pedido_sap = pedido_sap[:50]
    pedido.observacoes = observacoes
    pedido.valor_total = valor_total if valor_total is not None else total_itens
    pedido.resumo = resumo if resumo else f"Pedido {pedido_sap} para {cliente} — " + '; '.join(f"{item['produto']} ({item['quantidade']})" for item in itens_payload) + f" — total {pedido.valor_total:.2f}"
    for item in list(pedido.itens):
        db.session.delete(item)
    for indice, item_data in enumerate(itens_payload):
        try:
            quantidade_num = float(item_data['quantidade'])
        except ValueError:
            return jsonify({'erro': 'Quantidade de produto inválida.'}), 400
        valor_item = parse_preco(item_data['valor'])
        imagem = request.files.get(f'itens[{indice}][imagem]')
        imagem_filename = None
        if imagem and imagem.filename:
            extensao = os.path.splitext(secure_filename(imagem.filename))[1].lower()
            if extensao not in {'.png', '.jpg', '.jpeg', '.webp'}:
                return jsonify({'erro': 'A imagem deve estar em PNG, JPG, JPEG ou WEBP.'}), 400
            imagem_filename = f'{uuid.uuid4().hex}{extensao}'
            imagem.save(os.path.join(COMERCIAL_UPLOAD_FOLDER, imagem_filename))
        db.session.add(PedidoComercialItem(
            pedido_id=pedido.id,
            produto=item_data['produto'][:150],
            quantidade=quantidade_num,
            valor=valor_item,
            observacao=str(item_data.get('observacao', '')).strip()[:1000],
            imagem_filename=imagem_filename
        ))
    db.session.commit()
    return jsonify(pedido.to_dict()), 200

@api_bp.route('/comercial/pedidos/<int:pedido_id>', methods=['DELETE'])
@login_required
def delete_pedido_comercial(pedido_id):
    if current_user.perfil not in ('comercial', 'admin'):
        return jsonify({'erro': 'Acesso negado.'}), 403
    pedido = PedidoComercial.query.get_or_404(pedido_id)
    for item in list(pedido.itens):
        if item.imagem_filename:
            caminho = os.path.join(COMERCIAL_UPLOAD_FOLDER, item.imagem_filename)
            if os.path.exists(caminho):
                os.remove(caminho)
        db.session.delete(item)
    db.session.delete(pedido)
    db.session.commit()
    return jsonify({'sucesso': True}), 200

@api_bp.route('/comercial/pedidos/<int:pedido_id>/sap', methods=['PUT'])
@login_required
def confirmar_pedido_comercial_sap(pedido_id):
    if current_user.perfil not in ('comercial', 'admin'):
        return jsonify({'erro': 'Acesso negado.'}), 403
    pedido = PedidoComercial.query.get_or_404(pedido_id)
    dados = request.get_json(silent=True) or {}
    pedido.incluido_no_sap = bool(dados.get('incluido_no_sap', True))
    db.session.commit()
    return jsonify(pedido.to_dict()), 200

@api_bp.route('/comercial/imagens/<path:filename>', methods=['GET'])
@login_required
def get_imagem_pedido_comercial(filename):
    if current_user.perfil not in ('comercial', 'admin'):
        return jsonify({'erro': 'Acesso negado.'}), 403
    return send_from_directory(COMERCIAL_UPLOAD_FOLDER, filename)

@api_bp.route('/pedidos', methods=['POST'])
@login_required
def create_pedido_direto():
    if current_user.perfil in ['solicitante', 'estoque']:
        return jsonify({"erro": "Acesso negado."}), 403

    data = request.get_json() or {}
    try:
        itens_payload = normalizar_lista_itens(data.get('itens'))
        if not itens_payload and ('item' in data or 'valor_total' in data):
            itens_payload = [{'item': data.get('item'), 'quantidade': 1.0, 'valor_total': data.get('valor_total')}]
        if not itens_payload:
            return jsonify({"erro": "Informe ao menos um item para o pedido."}), 400

        fornecedor_input = str(data.get('fornecedor', '') or '').strip()
        fornecedor = fornecedor_cadastrado(fornecedor_input)
        if not fornecedor and current_user.perfil != 'gerente':
            return jsonify({"erro": "Fornecedor não cadastrado. Selecione um fornecedor homologado."}), 400
        valor_total_base = Decimal(str(data.get('valor_total', 0) or 0)) if data.get('valor_total') is not None else None
        prazo_dias = PedidoCompra.converter_prazo_dias(data.get('prazo_dias', 7))
        status = data.get('status', 'gerado')
        pedidos_criados = []

        for item_payload in itens_payload:
            item_nome = str(item_payload.get('item') or '').strip()
            if not item_nome:
                return jsonify({"erro": "Um dos itens do pedido está sem descrição."}), 400
            valor_total = item_payload.get('valor_total')
            if valor_total is None:
                valor_total = valor_total_base
            if valor_total is None:
                return jsonify({"erro": "Para pedidos com múltiplos itens, informe o valor_total para cada item."}), 400
            valor_total = Decimal(str(valor_total))
            if valor_total <= 0:
                return jsonify({"erro": "O valor total deve ser maior que zero."}), 400

            quantidade = item_payload.get('quantidade')
            if quantidade is None:
                quantidade = 1.0
            try:
                quantidade = float(quantidade)
            except (TypeError, ValueError):
                return jsonify({"erro": f"A quantidade do item '{item_nome}' é inválida."}), 400
            if quantidade <= 0:
                return jsonify({"erro": f"A quantidade do item '{item_nome}' deve ser maior que zero."}), 400

            novo = PedidoCompra(
                item_nome=item_nome,
                quantidade=quantidade,
                fornecedor=fornecedor.razao_social if fornecedor else fornecedor_input,
                valor_total=valor_total,
                prazo_dias=prazo_dias,
                status=status,
                data_entrega=datetime.utcnow() if status == 'entregue' else None
            )
            db.session.add(novo)
            db.session.flush()
            db.session.add(Comentario(tipo_ref='PO', ref_id=novo.id, texto=f"Pedido de compra direto criado por {current_user.nome}."))
            pedidos_criados.append(novo)

        db.session.commit()
        resposta = [pedido.to_dict() for pedido in pedidos_criados]
        return jsonify(resposta[0] if len(resposta) == 1 else {"pedidos": resposta}), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({"erro": "Erro interno", "detalhes": str(e)}), 500

@api_bp.route('/pedidos/<int:id>', methods=['PUT'])
@login_required
def editar_pedido(id):
    if current_user.perfil in ['solicitante', 'estoque']:
        return jsonify({"erro": "Acesso negado."}), 403
    data = request.get_json() or {}
    po = PedidoCompra.query.get_or_404(id)
    try:
        if 'item' in data:
            item_nome = str(data['item'] or '').strip()
            if not item_nome:
                return jsonify({"erro": "O campo 'item' é obrigatório."}), 400
            po.item_nome = item_nome
        if 'valor_total' in data:
            valor_total = Decimal(str(data['valor_total']))
            if valor_total <= 0:
                return jsonify({"erro": "O valor total deve ser maior que zero."}), 400
            po.valor_total = valor_total
        if 'fornecedor' in data:
            fornecedor_input = str(data['fornecedor'] or '').strip()
            fornecedor = fornecedor_cadastrado(fornecedor_input)
            if not fornecedor and current_user.perfil != 'gerente':
                return jsonify({"erro": "Fornecedor não cadastrado. Selecione um fornecedor homologado."}), 400
            po.fornecedor = fornecedor.razao_social if fornecedor else fornecedor_input
        if 'prazo_dias' in data:
            po.prazo_dias = PedidoCompra.converter_prazo_dias(data['prazo_dias'])
        if 'status' in data:
            status = str(data['status'] or '').strip()
            if not status:
                return jsonify({"erro": "O campo 'status' é obrigatório."}), 400
            po.status = status

        db.session.add(Comentario(tipo_ref='PO', ref_id=id, texto=f"Pedido editado por {current_user.nome}."))
        db.session.commit()
        return jsonify(po.to_dict()), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"erro": "Erro interno", "detalhes": str(e)}), 500

@api_bp.route('/pedidos/<int:id>/status', methods=['PUT'])
@login_required
def atualizar_status_pedido(id):
    data = request.get_json()
    if not data or 'status' not in data:
        return jsonify({"erro": "O campo 'status' é obrigatório."}), 400
    po = PedidoCompra.query.get_or_404(id)
    try:
        antigo = po.status
        po.status = data['status']
        if po.status == 'entregue' and antigo != 'entregue':
            po.data_entrega = datetime.utcnow()
        elif po.status != 'entregue' and antigo == 'entregue':
            po.data_entrega = None
        db.session.add(Comentario(tipo_ref='PO', ref_id=id, texto=f"Status alterado de '{antigo}' para '{po.status}' por {current_user.nome}."))
        db.session.commit()
        return jsonify(po.to_dict()), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"erro": "Falha", "detalhes": str(e)}), 500

@api_bp.route('/pedidos/exportar', methods=['GET'])
@login_required
def exportar_pedidos():
    pedidos = PedidoCompra.query.order_by(PedidoCompra.id.desc()).all()
    si = StringIO()
    writer = csv.writer(si, delimiter=';')
    writer.writerow(['PO ID', 'SC Ref', 'Item', 'Fornecedor', 'Valor Total (R$)', 'Status', 'Data de Emissão', 'Prazo Previsão', 'Data Entrega'])
    for po in pedidos:
        nome_exib = po.item_nome if po.item_nome else (po.solicitacao.item if po.solicitacao else "N/A")
        data_prevista = po.data_emissao + timedelta(days=po.prazo_dias or 7)
        writer.writerow([f"PO-{500 + po.id}", f"SC-{1000 + po.solicitacao_id}" if po.solicitacao_id else "Direto", nome_exib, po.fornecedor, str(po.valor_total), po.status, po.data_emissao.strftime("%d/%m/%Y"), f"{po.prazo_dias or 7} dias", data_prevista.strftime("%d/%m/%Y")])
    output = si.getvalue()
    si.close()
    response = make_response(output)
    response.headers["Content-Disposition"] = "attachment; filename=relatorio_pedidos_compras.csv"
    response.headers["Content-type"] = "text/csv; charset=utf-8"
    return response

# ===============================================
# FORNECEDORES E OCORRÊNCIAS (ATUALIZADO)
# ===============================================
@api_bp.route('/fornecedores', methods=['GET'])
@login_required
def get_fornecedores():
    fornecedores = Fornecedor.query.order_by(Fornecedor.razao_social.asc()).all()
    resultado = []
    for f in fornecedores:
        d = f.to_dict()
        ocorrencias = Comentario.query.filter_by(tipo_ref='FORN', ref_id=f.id).order_by(Comentario.id.desc()).all()
        d['ocorrencias'] = [o.to_dict() for o in ocorrencias]
        resultado.append(d)
    return jsonify(resultado), 200

@api_bp.route('/fornecedores', methods=['POST'])
@login_required
def create_fornecedor():
    if current_user.perfil in ['solicitante', 'estoque']:
        return jsonify({"erro": "Acesso negado."}), 403
    data = request.get_json()
    try:
        novo = Fornecedor(
            cnpj=str(data['cnpj']).strip(), razao_social=str(data['razao_social']).strip(),
            nome_fantasia=str(data.get('nome_fantasia', '') or '').strip(),
            codigo=str(data.get('codigo', '') or '').strip() or None,
            uf=str(data.get('uf', '') or '').strip().upper(),
            cidade=str(data.get('cidade', '') or '').strip(),
            ativo=bool(data.get('ativo', True)), categoria=str(data.get('categoria', 'Não informada') or 'Não informada').strip()
        )
        db.session.add(novo)
        db.session.commit()
        return jsonify(novo.to_dict()), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({"erro": "Falha (CNPJ já cadastrado ou erro interno)", "detalhes": str(e)}), 500

@api_bp.route('/fornecedores/<int:id>', methods=['PUT'])
@login_required
def update_fornecedor(id):
    if current_user.perfil in ['solicitante', 'estoque']:
        return jsonify({"erro": "Acesso negado."}), 403
    fornecedor = Fornecedor.query.get_or_404(id)
    data = request.get_json() or {}
    cnpj = str(data.get('cnpj', '')).strip()
    razao_social = str(data.get('razao_social', '')).strip()
    codigo = str(data.get('codigo', '') or '').strip() or None
    if not cnpj or not razao_social:
        return jsonify({"erro": "CNPJ e Razão Social são obrigatórios."}), 400
    if Fornecedor.query.filter(Fornecedor.cnpj == cnpj, Fornecedor.id != id).first():
        return jsonify({"erro": "Já existe outro fornecedor com este CNPJ."}), 400
    if codigo and Fornecedor.query.filter(Fornecedor.codigo == codigo, Fornecedor.id != id).first():
        return jsonify({"erro": "Já existe outro fornecedor com este código."}), 400
    try:
        fornecedor.cnpj = cnpj
        fornecedor.razao_social = razao_social
        fornecedor.nome_fantasia = str(data.get('nome_fantasia', '') or '').strip()
        fornecedor.codigo = codigo
        fornecedor.uf = str(data.get('uf', '') or '').strip().upper()
        fornecedor.cidade = str(data.get('cidade', '') or '').strip()
        fornecedor.ativo = bool(data.get('ativo', True))
        fornecedor.categoria = str(data.get('categoria', 'Não informada') or 'Não informada').strip()
        db.session.commit()
        return jsonify(fornecedor.to_dict()), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"erro": "Não foi possível atualizar o fornecedor.", "detalhes": str(e)}), 400

@api_bp.route('/fornecedores/<int:id>', methods=['DELETE'])
@login_required
def delete_fornecedor(id):
    if current_user.perfil in ['solicitante', 'estoque']:
        return jsonify({"erro": "Acesso negado."}), 403
    fornecedor = Fornecedor.query.get_or_404(id)
    try:
        Comentario.query.filter_by(tipo_ref='FORN', ref_id=id).delete(synchronize_session=False)
        db.session.delete(fornecedor)
        db.session.commit()
        return jsonify({"mensagem": "Fornecedor excluído com sucesso."}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"erro": "Não foi possível excluir o fornecedor.", "detalhes": str(e)}), 409

@api_bp.route('/fornecedores/importar', methods=['POST'])
@login_required
def importar_fornecedores():
    if current_user.perfil in ['solicitante', 'estoque']:
        return jsonify({"erro": "Acesso negado."}), 403
    arquivo = request.files.get('arquivo')
    if not arquivo or not arquivo.filename.lower().endswith(('.xls', '.xlsx', '.xlsm')):
        return jsonify({"erro": "Envie um arquivo Excel .xls, .xlsx ou .xlsm."}), 400
    try:
        nome_arquivo = arquivo.filename.lower()
        if nome_arquivo.endswith('.xls'):
            import xlrd
            livro = xlrd.open_workbook(file_contents=arquivo.read(), on_demand=True)
            planilha = livro.sheet_by_index(0)
            linhas = [planilha.row_values(indice) for indice in range(planilha.nrows)]
        else:
            planilha = load_workbook(arquivo, read_only=True, data_only=True).active
            linhas = list(planilha.iter_rows(values_only=True))
        if not linhas:
            return jsonify({"erro": "A planilha está vazia."}), 400
        aliases = {
            'razao_social': ['razao social'], 'nome_fantasia': ['nome fantasia'],
            'codigo': ['codigo'], 'cnpj': ['cnpj'], 'uf': ['uf'],
            'cidade': ['cidade'], 'ativo': ['ativo']
        }
        cabecalho_idx = next((i for i, linha in enumerate(linhas[:10]) if 'razao social' in [normalizar_texto(v) for v in linha]), None)
        if cabecalho_idx is None:
            return jsonify({"erro": "A planilha deve conter a coluna 'Razão Social'."}), 400
        cabecalhos = [normalizar_texto(v) for v in linhas[cabecalho_idx]]
        indices = {campo: cabecalhos.index(nome) for campo, nomes in aliases.items() for nome in nomes if nome in cabecalhos}
        if 'razao_social' not in indices or 'cnpj' not in indices:
            return jsonify({"erro": "A planilha deve conter as colunas 'Razão Social' e 'CNPJ'."}), 400

        def valor_texto(valor):
            if valor is None:
                return ''
            if isinstance(valor, float) and valor.is_integer():
                return str(int(valor))
            return str(valor).strip()

        def valor_ativo(valor):
            return valor_texto(valor).lower() in ('sim', 's', 'ativo', 'true', '1', 'yes')

        importados = atualizados = 0
        ignorados = []
        for numero_linha, valores in enumerate(linhas[cabecalho_idx + 1:], start=cabecalho_idx + 2):
            razao = valor_texto(valores[indices['razao_social']])
            cnpj = valor_texto(valores[indices['cnpj']])
            if not razao and not cnpj:
                continue
            if not razao or not cnpj:
                ignorados.append(f'linha {numero_linha}: Razão Social e CNPJ são obrigatórios')
                continue
            codigo = valor_texto(valores[indices['codigo']]) if 'codigo' in indices else ''
            fornecedor = Fornecedor.query.filter_by(cnpj=cnpj).first()
            if not fornecedor and codigo:
                fornecedor = Fornecedor.query.filter_by(codigo=codigo).first()
            if not fornecedor:
                fornecedor = Fornecedor(cnpj=cnpj, razao_social=razao, categoria='Não informada')
                db.session.add(fornecedor)
                importados += 1
            else:
                atualizados += 1
            fornecedor.cnpj = cnpj
            fornecedor.razao_social = razao
            fornecedor.nome_fantasia = valor_texto(valores[indices['nome_fantasia']]) if 'nome_fantasia' in indices else fornecedor.nome_fantasia or ''
            fornecedor.codigo = codigo or fornecedor.codigo
            fornecedor.uf = valor_texto(valores[indices['uf']]).upper() if 'uf' in indices else fornecedor.uf or ''
            fornecedor.cidade = valor_texto(valores[indices['cidade']]) if 'cidade' in indices else fornecedor.cidade or ''
            if 'ativo' in indices:
                fornecedor.ativo = valor_ativo(valores[indices['ativo']])
        db.session.commit()
        return jsonify({"importados": importados, "atualizados": atualizados, "ignorados": ignorados}), 201
    except ImportError:
        db.session.rollback()
        return jsonify({"erro": "Suporte a arquivos .xls indisponível. Instale a dependência xlrd==2.0.1."}), 500
    except Exception as e:
        db.session.rollback()
        return jsonify({"erro": "Falha ao importar planilha", "detalhes": str(e)}), 400

@api_bp.route('/fornecedores/modelo', methods=['GET'])
@login_required
def baixar_modelo_fornecedores():
    planilha = Workbook()
    aba = planilha.active
    aba.title = 'Fornecedores'
    aba.append(['RAZÃO SOCIAL', 'NOME FANTASIA', 'CÓDIGO', 'CNPJ', 'UF', 'CIDADE', 'Ativo'])
    aba.append(['EXEMPLO COMERCIO LTDA', 'EXEMPLO', 'F0001', '00.000.000/0001-00', 'PE', 'Recife', 'Sim'])
    aba.freeze_panes = 'A2'
    for coluna in aba.columns:
        aba.column_dimensions[coluna[0].column_letter].width = min(max(len(str(coluna[0].value or '')) + 2, 14), 35)
    arquivo = BytesIO()
    planilha.save(arquivo)
    arquivo.seek(0)
    return send_file(arquivo, as_attachment=True, download_name='modelo_importacao_fornecedores.xlsx', mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

@api_bp.route('/fornecedores/<int:id>/ocorrencias', methods=['POST'])
@login_required
def registrar_ocorrencia_fornecedor(id):
    if current_user.perfil in ['solicitante', 'estoque']:
        return jsonify({"erro": "Acesso negado."}), 403
    fornecedor = Fornecedor.query.get_or_404(id)
    data = request.get_json()
    try:
        texto_ocorrencia = f"⚠️ OCORRÊNCIA [{data['tipo'].upper()}]: {data['descricao']} (Registrado por {current_user.nome})"
        novo_comentario = Comentario(tipo_ref='FORN', ref_id=fornecedor.id, texto=texto_ocorrencia)
        db.session.add(novo_comentario)
        if data['tipo'].lower() in ['defeito', 'grave', 'divergencia']:
            fornecedor.avaliacao = '⭐'
        db.session.commit()
        return jsonify({"mensagem": "Ocorrência registrada com sucesso!"}), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({"erro": "Erro ao registrar ocorrência", "detalhes": str(e)}), 500

# ===============================================
# COMENTÁRIOS E ETIQUETAS
# ===============================================
@api_bp.route('/comentarios/<tipo>/<int:ref_id>', methods=['GET'])
@login_required
def get_comentarios(tipo, ref_id):
    comentarios = Comentario.query.filter_by(tipo_ref=tipo, ref_id=ref_id).order_by(Comentario.id.desc()).all()
    return jsonify([c.to_dict() for c in comentarios]), 200

@api_bp.route('/comentarios', methods=['POST'])
@login_required
def add_comentario():
    data = request.get_json()
    try:
        texto = str(data.get('texto', '')).strip()
        if not texto:
            return jsonify({"erro": "O comentário não pode estar vazio."}), 400

        codigo_adicionar = extrair_comando_adicionar_item(texto)
        codigo_remover = extrair_comando_remover_item(texto)
        codigos_receber = extrair_comando_receber_itens(texto)
        
        texto_formatado = f"{current_user.nome}: {texto}"
        
        if codigo_adicionar or codigo_remover or codigos_receber:
            if data.get('tipo') != 'SC':
                return jsonify({"erro": "Os comandos /ADD, /REMOVE e /RECEBER só podem ser usados em cartões de solicitação (SC)."}), 400
            solicitacao = SolicitacaoCompra.query.get(data.get('ref_id'))
            if not solicitacao:
                return jsonify({"erro": "Solicitação de compra não encontrada."}), 404
            if solicitacao.status in ('cancelado', 'aprovado', 'entregue'):
                return jsonify({"erro": "Não é possível adicionar itens a uma solicitação encerrada."}), 400
            if codigo_adicionar:
                item_adicionado = adicionar_item_por_comando(solicitacao, codigo_adicionar)
                texto_formatado += f" - Item adicionado: {item_adicionado.descricao} (quantidade: 1)."
            elif codigo_remover:
                item_removido = remover_item_por_comando(solicitacao, codigo_remover)
                texto_formatado += f" - Item removido: {item_removido.descricao}."
            if codigos_receber:
                itens_recebidos = receber_itens_por_comando(solicitacao, codigos_receber)
                texto_formatado += f" - Itens concluídos individualmente: {', '.join(itens_recebidos)}."

        comando_previsao = re.match(r'^\s*/previs(?:ão|ao)\b', texto, re.IGNORECASE)
        previsao = extrair_previsao(texto)
        if comando_previsao and previsao is None:
            raise ValueError('Informe uma data válida após /previsão, por exemplo: /previsão 29/08/2026.')
        if previsao:
            if data.get('tipo') != 'PO':
                return jsonify({"erro": "A previsão de entrega só pode ser alterada em pedidos de compra."}), 400
            pedido = PedidoCompra.query.get(data.get('ref_id'))
            if not pedido:
                return jsonify({"erro": "Pedido de compra não encontrado."}), 404
            if previsao < pedido.data_emissao.date():
                return jsonify({"erro": "A previsão não pode ser anterior à data de emissão do pedido."}), 400
            pedido.prazo_dias = (previsao - pedido.data_emissao.date()).days

        novo = Comentario(tipo_ref=data['tipo'], ref_id=data['ref_id'], texto=texto_formatado)
        db.session.add(novo)
        db.session.commit()
        return jsonify(novo.to_dict()), 201
    except ValueError as e:
        db.session.rollback()
        return jsonify({"erro": str(e)}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({"erro": "Falha ao comentar", "detalhes": str(e)}), 500
@api_bp.route('/etiquetas/<tipo>/<int:ref_id>', methods=['PUT'])
@login_required
def update_etiquetas(tipo, ref_id):
    data = request.get_json()
    try:
        etiquetas = str(data.get('etiquetas', '') or '').strip().lower()
        if etiquetas not in ('', 'emergencia'):
            return jsonify({"erro": "A única etiqueta permitida é emergencia."}), 400
        obj = SolicitacaoCompra.query.get(ref_id) if tipo == 'SC' else PedidoCompra.query.get(ref_id)
        if obj:
            obj.etiquetas = etiquetas
            db.session.commit()
            return jsonify({"mensagem": "Ok"}), 200
        return jsonify({"erro": "Nao encontrado"}), 404
    except Exception as e:
        db.session.rollback()
        return jsonify({"erro": "Falha", "detalhes": str(e)}), 500

# ===============================================
# MRP - PLANEJAMENTO
# ===============================================
def _normalizar_nome_material(nome):
    texto = unicodedata.normalize('NFKD', str(nome or '')).encode('ascii', 'ignore').decode('ascii').lower()
    return ' '.join(texto.replace('-', ' ').split())


def _historico_do_material(nome):
    nome_normalizado = _normalizar_nome_material(nome)
    if nome_normalizado.startswith('piquet marinho'):
        termos = ('piquet marinho',)
    elif nome_normalizado.startswith('piquet ouro'):
        termos = ('piquet ouro',)
    elif nome_normalizado.startswith('camisa piquet'):
        termos = ()
    else:
        marca = nome_normalizado.split(' ', 1)[0]
        termos = (marca,) if marca else ()

    registros = []
    for registro in FormacaoPreco.query.order_by(FormacaoPreco.id.asc()).all():
        material_preco = _normalizar_nome_material(registro.material_nome)
        if termos and any(termo in material_preco for termo in termos):
            registros.append(registro.to_dict())
    return registros


def _valor_planilha_json(valor):
    if isinstance(valor, (datetime, date)):
        return valor.isoformat()
    return valor


@lru_cache(maxsize=1)
def _abas_planilha_mrp():
    caminho = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'Materiais.xlsx')
    if not os.path.exists(caminho):
        caminho = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'Compra de Materiais.xlsx')
    if not os.path.exists(caminho):
        return {}
    from openpyxl import load_workbook
    arquivo = load_workbook(caminho, read_only=True, data_only=True)
    return {
        aba: [[_valor_planilha_json(valor) for valor in linha] for linha in planilha.iter_rows(values_only=True)]
        for aba, planilha in ((nome, arquivo[nome]) for nome in arquivo.sheetnames)
    }


def _planilha_do_material(nome):
    normalizado = _normalizar_nome_material(nome)
    abas = _abas_planilha_mrp()
    correspondencias = [aba for aba in abas if normalizado.startswith(_normalizar_nome_material(aba))]
    if not correspondencias:
        return {'aba': None, 'linhas': []}
    aba = max(correspondencias, key=len)
    return {'aba': aba, 'linhas': abas[aba]}


@api_bp.route('/planejamento/importar', methods=['POST'])
@login_required
def importar_planejamento_excel():
    if current_user.perfil in ['solicitante', 'estoque', 'gerente']:
        return jsonify({'erro': 'Acesso negado ao MRP.'}), 403
    arquivo = request.files.get('arquivo')
    if not arquivo or not arquivo.filename:
        return jsonify({'erro': 'Selecione um arquivo Excel.'}), 400
    extensao = os.path.splitext(arquivo.filename)[1].lower()
    if extensao not in {'.xlsx', '.xlsm'}:
        return jsonify({'erro': 'O MRP aceita arquivos .xlsx ou .xlsm.'}), 400
    caminho_temporario = None
    try:
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=extensao, delete=False) as temporario:
            arquivo.save(temporario)
            caminho_temporario = temporario.name
        from mrp_import import materiais_da_planilha
        materiais, quantidade_abas = materiais_da_planilha(caminho_temporario)
        if not materiais:
            return jsonify({'erro': 'Nenhum material foi encontrado nas abas do arquivo.'}), 400
        nomes_importados = set()
        for dados in materiais:
            nomes_importados.add(dados['nome'])
            material = MaterialPlanejamento.query.filter_by(nome=dados['nome']).first()
            if material is None:
                material = MaterialPlanejamento(nome=dados['nome'])
                db.session.add(material)
            material.estoque_atual = dados['estoque']
            material.consumo_por_peca = dados['consumo']
            material.demanda_pecas = dados['demanda']
            material.comprado_recebido = dados['comprado']
            material.produto_nome = material.produto_nome or dados['nome']
            material.material_utilizado = material.material_utilizado or dados['nome']
            material.planilha_aba = dados['aba']
            material.planilha_nome = secure_filename(arquivo.filename) or arquivo.filename
            material.historico_planilha = json.dumps(dados['historico'], ensure_ascii=False)
        db.session.commit()
        return jsonify({'mensagem': 'Planilha do MRP importada com sucesso.', 'abas': quantidade_abas, 'materiais': len(nomes_importados)}), 201
    except Exception as erro:
        db.session.rollback()
        return jsonify({'erro': 'Falha ao importar a planilha do MRP.', 'detalhes': str(erro)}), 400
    finally:
        if caminho_temporario and os.path.exists(caminho_temporario):
            try:
                os.remove(caminho_temporario)
            except PermissionError:
                pass


@api_bp.route('/planejamento', methods=['GET'])
@login_required
def get_planejamento():
    if current_user.perfil in ['solicitante', 'estoque', 'gerente']:
        return jsonify({"erro": "Acesso negado ao MRP."}), 403
    materiais = MaterialPlanejamento.query.all()
    resposta = []
    for material in materiais:
        dados = material.to_dict()
        historico = _historico_do_material(material.nome)
        dados['historico'] = historico
        dados['compras'] = [compra.to_dict() for compra in sorted(material.compras_mrp, key=lambda compra: compra.id)]
        dados['pedidos_mrp'] = [pedido.to_dict() for pedido in sorted(material.pedidos_mrp, key=lambda pedido: pedido.id)]
        try:
            linhas_importadas = json.loads(material.historico_planilha or '[]')
        except (TypeError, ValueError):
            linhas_importadas = []
        dados['planilha'] = (
            {'aba': material.planilha_aba, 'linhas': linhas_importadas}
            if linhas_importadas else _planilha_do_material(material.nome)
        )
        dados['resumo_historico'] = {
            'registros': len(historico),
            'ultimo_preco_kg': next((item['preco_final_kg'] for item in reversed(historico) if item['preco_final_kg'] is not None), None),
            'media_preco_kg': round(sum(item['preco_final_kg'] for item in historico if item['preco_final_kg'] is not None) / len([item for item in historico if item['preco_final_kg'] is not None]), 4) if any(item['preco_final_kg'] is not None for item in historico) else None,
            'media_fio_kg': round(sum(item['valor_fio_kg'] for item in historico if item['valor_fio_kg'] is not None) / len([item for item in historico if item['valor_fio_kg'] is not None]), 4) if any(item['valor_fio_kg'] is not None for item in historico) else None,
            'fontes': sorted({item['material_nome'] for item in historico})
        }
        resposta.append(dados)
    return jsonify(resposta), 200

@api_bp.route('/planejamento', methods=['POST'])
@login_required
def create_planejamento():
    if current_user.perfil in ['solicitante', 'estoque', 'gerente']:
        return jsonify({"erro": "Acesso negado."}), 403
    data = request.get_json()
    try:
        item_id = data.get('item_id')
        item = Item.query.get(int(item_id)) if item_id not in (None, '') else None
        produto_nome = str(data.get('produto_nome', '')).strip()
        material_utilizado = str(data.get('material_utilizado', '')).strip()
        if not produto_nome or not material_utilizado:
            return jsonify({"erro": "Informe o nome do produto e o material utilizado."}), 400
        novo = MaterialPlanejamento(
            item_id=item.id if item else None,
            nome=material_utilizado,
            produto_nome=produto_nome,
            cliente=str(data.get('cliente', '')).strip(),
            material_utilizado=material_utilizado,
            estoque_atual=float(data.get('estoque_atual', 0)),
            demanda_pecas=float(data.get('demanda_pecas', 0)), 
            consumo_por_peca=float(data.get('consumo_por_peca', 0)),
            comprado_recebido=float(data.get('comprado_recebido', 0)),
            eh_demillus=bool(data.get('eh_demillus', False))
        )
        db.session.add(novo)
        db.session.commit()
        return jsonify(novo.to_dict()), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({"erro": "Erro interno", "detalhes": str(e)}), 500

@api_bp.route('/planejamento/<int:id>', methods=['PUT'])
@login_required
def update_planejamento(id):
    if current_user.perfil in ['solicitante', 'estoque', 'gerente']:
        return jsonify({"erro": "Acesso negado."}), 403
    data = request.get_json()
    m = MaterialPlanejamento.query.get_or_404(id)
    try:
        if 'item_id' in data and data['item_id'] not in (None, ''):
            item = Item.query.get(int(data['item_id'])) if data['item_id'] not in (None, '') else None
            if not item:
                return jsonify({"erro": "Selecione um item cadastrado como referência do material."}), 400
            m.item_id = item.id
        if 'produto_nome' in data and str(data['produto_nome']).strip(): m.produto_nome = str(data['produto_nome']).strip()
        if 'cliente' in data: m.cliente = str(data['cliente'] or '').strip()
        if 'material_utilizado' in data and str(data['material_utilizado']).strip():
            m.material_utilizado = str(data['material_utilizado']).strip()
            m.nome = m.material_utilizado
        if 'estoque_atual' in data: m.estoque_atual = float(data['estoque_atual'])
        if 'demanda_pecas' in data: m.demanda_pecas = float(data['demanda_pecas'])
        if 'consumo_por_peca' in data: m.consumo_por_peca = float(data['consumo_por_peca'])
        if 'comprado_recebido' in data: m.comprado_recebido = float(data['comprado_recebido'])
        if 'eh_demillus' in data: m.eh_demillus = bool(data['eh_demillus'])
        if 'oculto' in data: m.oculto = bool(data['oculto'])
        db.session.commit()
        return jsonify(m.to_dict()), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"erro": "Erro interno", "detalhes": str(e)}), 500

@api_bp.route('/planejamento/pedidos', methods=['POST'])
@login_required
def create_pedido_mrp():
    if current_user.perfil in ['solicitante', 'estoque', 'gerente']:
        return jsonify({'erro': 'Acesso negado.'}), 403
    data = request.get_json() or {}
    try:
        linhas = data.get('materiais') or []
        ids_recebidos = [linha.get('material_id') for linha in linhas] if linhas else (data.get('material_ids') or [data.get('material_id')])
        ids = {int(material_id) for material_id in ids_recebidos if material_id not in (None, '')}
        materiais = MaterialPlanejamento.query.filter(MaterialPlanejamento.id.in_(ids)).all() if ids else []
        if not materiais or len(materiais) != len(ids):
            return jsonify({'erro': 'Selecione pelo menos um material válido.'}), 400
        produto = str(data.get('produto', '')).strip()
        quantidade = float(data.get('quantidade_pecas')) if data.get('quantidade_pecas') not in (None, '') else None
        if not produto or (not linhas and (quantidade is None or quantidade <= 0)):
            return jsonify({'erro': 'Selecione um produto e informe uma quantidade de peças positiva.'}), 400
    except (TypeError, ValueError):
        return jsonify({'erro': 'Selecione um produto e informe uma quantidade de peças positiva.'}), 400
    grupos = {(str(material.cliente or '').strip().lower(), str(material.produto_nome or material.nome).strip().lower()) for material in materiais}
    if len(grupos) != 1:
        return jsonify({'erro': 'Selecione materiais do mesmo cliente e produto.'}), 400
    try:
        quantidades = {int(linha['material_id']): float(linha.get('quantidade_pecas')) for linha in linhas} if linhas else {material.id: quantidade for material in materiais}
    except (AttributeError, TypeError, ValueError):
        return jsonify({'erro': 'Informe uma quantidade válida para cada material selecionado.'}), 400
    if set(quantidades) != ids or any(valor <= 0 for valor in quantidades.values()):
        return jsonify({'erro': 'Informe uma quantidade de peças positiva para cada material.'}), 400
    pedidos = []
    for material in materiais:
        consumo = float(material.consumo_por_peca or 0)
        quantidade_material = quantidades[material.id]
        pedidos.append(PedidoMRP(material=material, cliente=str(material.cliente or '').strip(), produto=produto, quantidade_pecas=quantidade_material, consumo_por_peca=consumo, consumo_total=quantidade_material * consumo))
        material.demanda_pecas = float(material.demanda_pecas or 0) + quantidade_material
    db.session.add_all(pedidos)
    db.session.commit()
    return jsonify([pedido.to_dict() for pedido in pedidos]), 201

@api_bp.route('/planejamento/<int:id>', methods=['DELETE'])
@login_required
def delete_planejamento(id):
    if current_user.perfil in ['solicitante', 'estoque', 'gerente']:
        return jsonify({"erro": "Acesso negado."}), 403
    material = MaterialPlanejamento.query.get_or_404(id)
    db.session.delete(material)
    db.session.commit()
    return jsonify({'mensagem': 'Produto excluído do planejamento MRP.'}), 200

@api_bp.route('/planejamento/<int:id>/compras', methods=['POST'])
@login_required
def create_compra_mrp(id):
    if current_user.perfil in ['solicitante', 'estoque', 'gerente']:
        return jsonify({"erro": "Acesso negado."}), 403
    data = request.get_json() or {}
    data_compra = str(data.get('data_compra', '')).strip()
    fornecedor = str(data.get('fornecedor', '')).strip()
    try:
        datetime.strptime(data_compra, '%Y-%m-%d')
        quantidade = float(data.get('quantidade')) if data.get('quantidade') not in (None, '') else None
        if not fornecedor:
            raise ValueError
    except (TypeError, ValueError):
        return jsonify({'erro': 'Informe data, quantidade positiva e fornecedor.'}), 400
    materiais = data.get('materiais')
    if materiais:
        registros = []
        try:
            for registro in materiais:
                material_id = registro.get('material_id')
                material = MaterialPlanejamento.query.get(material_id)
                quantidade_material = float(registro.get('quantidade'))
                pedido_ids = {int(pedido_id) for pedido_id in registro.get('pedido_ids', [])}
                pedidos = PedidoMRP.query.filter(
                    PedidoMRP.id.in_(pedido_ids), PedidoMRP.material_id == material_id
                ).all() if pedido_ids else []
                if not material or quantidade_material <= 0 or not pedido_ids or len(pedidos) != len(pedido_ids):
                    raise ValueError
                registros.append((CompraMRP(material=material, data_compra=data_compra, quantidade=quantidade_material, fornecedor=fornecedor), pedidos))
        except (TypeError, ValueError):
            return jsonify({'erro': 'Informe produtos, pedidos e quantidades válidas para a compra conjunta.'}), 400
        for compra, pedidos in registros:
            compra.pedidos = pedidos
            db.session.add(compra)
        db.session.commit()
        return jsonify([compra.to_dict() for compra, _ in registros]), 201
    if quantidade is None or quantidade <= 0:
        return jsonify({'erro': 'Informe uma quantidade positiva.'}), 400
    material = MaterialPlanejamento.query.get_or_404(id)
    try:
        pedido_ids = {int(pedido_id) for pedido_id in data.get('pedido_ids', [])}
    except (TypeError, ValueError):
        pedido_ids = set()
    if not pedido_ids:
        return jsonify({'erro': 'Vincule a compra a pelo menos um pedido incluído.'}), 400
    pedidos = PedidoMRP.query.filter(PedidoMRP.id.in_(pedido_ids), PedidoMRP.material_id == material.id).all()
    if len(pedidos) != len(pedido_ids):
        return jsonify({'erro': 'Há pedidos inválidos ou de outro material selecionados.'}), 400
    compra = CompraMRP(material=material, data_compra=data_compra, quantidade=quantidade, fornecedor=fornecedor, pedidos=pedidos)
    db.session.add(compra)
    db.session.commit()
    return jsonify(compra.to_dict()), 201

@api_bp.route('/planejamento/<int:id>/compras/<int:compra_id>/receber', methods=['PUT'])
@login_required
def receber_compra_mrp(id, compra_id):
    if current_user.perfil in ['solicitante', 'estoque']:
        return jsonify({"erro": "Acesso negado."}), 403
    compra = CompraMRP.query.filter_by(id=compra_id, material_id=id).first_or_404()
    data = request.get_json() or {}
    data_recebimento = str(data.get('data_recebimento', '')).strip()
    try:
        datetime.strptime(data_recebimento, '%Y-%m-%d')
        quantidade_recebida = float(data.get('quantidade_recebida'))
        limite = compra.quantidade - compra.quantidade_recebida
        if quantidade_recebida <= 0 or quantidade_recebida > limite:
            raise ValueError
    except (TypeError, ValueError):
        return jsonify({'erro': 'Informe data e uma quantidade recebida entre 0 e o saldo pendente.'}), 400
    compra.data_recebimento = data_recebimento
    compra.quantidade_recebida += quantidade_recebida
    db.session.commit()
    return jsonify(compra.to_dict()), 200

@api_bp.route('/planejamento/<int:id>/compras/<int:compra_id>', methods=['PUT', 'DELETE'])
@login_required
def gerenciar_compra_mrp(id, compra_id):
    if current_user.perfil in ['solicitante', 'estoque']:
        return jsonify({"erro": "Acesso negado."}), 403
    compra = CompraMRP.query.filter_by(id=compra_id, material_id=id).first_or_404()
    if request.method == 'DELETE':
        db.session.delete(compra)
        db.session.commit()
        return jsonify({'mensagem': 'Compra excluída.'}), 200
    data = request.get_json() or {}
    data_compra = str(data.get('data_compra', '')).strip()
    fornecedor = str(data.get('fornecedor', '')).strip()
    try:
        datetime.strptime(data_compra, '%Y-%m-%d')
        quantidade = float(data.get('quantidade'))
        if quantidade < compra.quantidade_recebida or not fornecedor:
            raise ValueError
    except (TypeError, ValueError):
        return jsonify({'erro': f'Informe data, fornecedor e quantidade igual ou maior que {compra.quantidade_recebida:g}.'}), 400
    compra.data_compra = data_compra
    compra.quantidade = quantidade
    compra.fornecedor = fornecedor
    db.session.commit()
    return jsonify(compra.to_dict()), 200

# ===============================================
# ROTAS DE MOTORISTAS
# ===============================================
@api_bp.route('/rotas', methods=['GET'])
@login_required
def get_rotas():
    rotas = RotaMotorista.query.order_by(RotaMotorista.id.desc()).all()
    return jsonify([r.to_dict() for r in rotas]), 200

@api_bp.route('/rotas', methods=['POST'])
@login_required
def create_rota():
    data = request.get_json()
    try:
        nova = RotaMotorista(
            data_prevista=data['data_prevista'], motorista=data['motorista'],
            destino_fornecedor=data['destino_fornecedor'], endereco=data.get('endereco', ''),
            localizacao_mapa=data.get('localizacao_mapa', ''), po_ref=data.get('po_ref', ''),
            observacoes=data.get('observacoes', '')
        )
        db.session.add(nova)
        db.session.commit()
        return jsonify(nova.to_dict()), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({"erro": "Falha", "detalhes": str(e)}), 500

@api_bp.route('/rotas/<int:id>', methods=['PUT'])
@login_required
def update_rota(id):
    rota = RotaMotorista.query.get_or_404(id)
    data = request.get_json() or {}
    obrigatorios = ['data_prevista', 'motorista', 'destino_fornecedor']
    if any(not str(data.get(campo, '')).strip() for campo in obrigatorios):
        return jsonify({"erro": "Data, motorista e destino são obrigatórios."}), 400
    try:
        rota.data_prevista = str(data['data_prevista']).strip()
        rota.motorista = str(data['motorista']).strip()
        rota.destino_fornecedor = str(data['destino_fornecedor']).strip()
        rota.endereco = str(data.get('endereco', '') or '').strip()
        rota.localizacao_mapa = str(data.get('localizacao_mapa', '') or '').strip()
        rota.po_ref = str(data.get('po_ref', '') or '').strip()
        rota.observacoes = str(data.get('observacoes', '') or '').strip()
        db.session.commit()
        return jsonify(rota.to_dict()), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"erro": "Não foi possível atualizar a rota.", "detalhes": str(e)}), 400

@api_bp.route('/rotas/<int:id>', methods=['DELETE'])
@login_required
def delete_rota(id):
    rota = RotaMotorista.query.get_or_404(id)
    try:
        db.session.delete(rota)
        db.session.commit()
        return jsonify({"mensagem": "Rota excluída com sucesso."}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"erro": "Não foi possível excluir a rota.", "detalhes": str(e)}), 409

@api_bp.route('/rotas/<int:id>/status', methods=['PUT'])
@login_required
def update_status_rota(id):
    data = request.get_json() or {}
    r = RotaMotorista.query.get_or_404(id)
    try:
        status = str(data.get('status', '')).strip().lower()
        if status not in ('pendente', 'em_rota', 'concluido'):
            return jsonify({"erro": "Status de rota inválido."}), 400
        r.status = status
        db.session.commit()
        return jsonify(r.to_dict()), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"erro": "Falha", "detalhes": str(e)}), 500

# ===============================================
# ANEXOS / UPLOADS DE ARQUIVOS
# ===============================================
@api_bp.route('/anexos/<tipo>/<int:ref_id>', methods=['GET'])
@login_required
def get_anexos(tipo, ref_id):
    anexos = Anexo.query.filter_by(tipo_ref=tipo, ref_id=ref_id).order_by(Anexo.id.desc()).all()
    return jsonify([a.to_dict() for a in anexos]), 200

@api_bp.route('/anexos', methods=['POST'])
@login_required
def upload_anexo():
    if 'file' not in request.files:
        return jsonify({"erro": "Nenhum arquivo enviado"}), 400
        
    file = request.files['file']
    tipo = request.form.get('tipo')
    ref_id = request.form.get('ref_id')
    
    if file.filename == '':
        return jsonify({"erro": "Nenhum arquivo selecionado"}), 400
        
    if not allowed_file(file.filename):
        return jsonify({
            "erro": "Tipo de arquivo não permitido.", 
            "detalhes": f"Apenas as extensões {', '.join(ALLOWED_EXTENSIONS)} são aceitas."
        }), 400
        
    if file and tipo and ref_id:
        filename = secure_filename(file.filename)
        safe_filename = f"{int(time.time())}_{filename}"
        filepath = os.path.join(UPLOAD_FOLDER, safe_filename)
        
        file.save(filepath)
        
        novo = Anexo(tipo_ref=tipo, ref_id=int(ref_id), nome_arquivo=filename, caminho_arquivo=safe_filename)
        db.session.add(novo)
        db.session.add(Comentario(tipo_ref=tipo, ref_id=int(ref_id), texto=f"Arquivo anexado: {filename} por {current_user.nome}."))
        db.session.commit()
        return jsonify(novo.to_dict()), 201
        
    return jsonify({"erro": "Dados inválidos"}), 400

@api_bp.route('/anexos/download/<int:id>', methods=['GET'])
@login_required
def download_anexo(id):
    anexo = Anexo.query.get_or_404(id)
    return send_from_directory(UPLOAD_FOLDER, anexo.caminho_arquivo, as_attachment=True, download_name=anexo.nome_arquivo)

@api_bp.route('/pedidos/<int:id>/item-status', methods=['PUT'])
@login_required
def atualizar_status_item_pedido(id):
    data = request.get_json() or {}
    item_indice = data.get('indice')
    status_item = str(data.get('status') or '').strip()
    
    if item_indice is None:
        return jsonify({"erro": "O índice do item é obrigatório."}), 400
        
    po = PedidoCompra.query.get_or_404(id)
    try:
        itens = json.loads(po.itens_detalhados or '[]')
    except (TypeError, ValueError):
        itens = []
        
    if not isinstance(itens, list) or item_indice < 0 or item_indice >= len(itens):
        return jsonify({"erro": "Item não encontrado no pedido."}), 404
        
    antigo = itens[item_indice].get('status', 'pendente')
    itens[item_indice]['status'] = status_item
    po.itens_detalhados = json.dumps(itens, ensure_ascii=False)
    
    # Se todos os itens do pedido estiverem entregues, opcionalmente atualiza o PO principal
    if all(i.get('status') == 'entregue' for i in itens):
        po.status = 'entregue'
        po.data_entrega = datetime.utcnow()

    db.session.add(Comentario(tipo_ref='PO', ref_id=id, texto=f"Item '{itens[item_indice].get('item')}' atualizado para '{status_item}' por {current_user.nome}."))
    db.session.commit()
    return jsonify(po.to_dict()), 200