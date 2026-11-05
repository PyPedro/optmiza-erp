import os
import json
import unicodedata
from datetime import date, datetime
from openpyxl import load_workbook
from app import app, db
from app.models import MaterialPlanejamento

CONSUMOS = {
    'Firantela - Estampado': .165, 'Firantela - Liso': .165, 'Monet - Estampado': .165, 'Monet - Liso': .165,
    'ARAZUL - Estampado': .165, 'ARAZUL - Liso': .165, 'SUNFLOWER - Estampado': .165, 'SUNFLOWER - Liso': .165,
    'PURISME - Estampado': .165, 'PURISME - Liso': .165, 'BLUEDREAM - Estampado': .165, 'BLUEDREAM - Liso': .165,
    'APRICOT - Estampado': .165, 'APRICOT - Liso': .165, 'VERÃO - PV CINZA': .22, 'VERÃO - RIBANA MARINHO': .008,
    'CAMISA - Piquet': 1.0, 'MOLETOM STELLANTIS - MARINHO': .36, 'MOLETOM STELLANTIS - MESCLA': .11,
    'STELLANTIS CALÇAS - Terbrim': 1.27, 'WHIRLPOOL CALÇAS - Twill': 1.3, 'PATÊ STELLANTIS - PIQUET MARINHO': .01,
    'TEKSID - TAPÉ': 1.0, 'TEKSID - SOLASOL': 1.0, 'TEKSID CAMISA - TAPÉ': 1.14, 'TEKSID CALÇA - SOLASOL': 1.26,
    'MOLETOM MARINHO - CASACO': .36, 'MOLETOM MESCLA - CASACO': .11, 'MOLETOM PAUSADO - MARINHO': .36,
    'MOLETOM PAUSADO - MESCLA': .11, 'PIQUET MARINHO - GERAL': 1.0, 'PIQUET OURO': 1.0,
}


def _normalizar(valor):
    texto = '' if valor is None else str(valor).strip()
    return ''.join(c for c in unicodedata.normalize('NFKD', texto).upper() if not unicodedata.combining(c))


def _numero(valor, padrao=0.0):
    if valor is None or str(valor).strip() == '':
        return padrao
    if isinstance(valor, (int, float)):
        return float(valor)
    texto = str(valor).replace('R$', '').replace('%', '').replace(' ', '')
    if ',' in texto:
        texto = texto.replace('.', '').replace(',', '.')
    try:
        return float(texto)
    except ValueError:
        return padrao


def _linha_resumo(linhas):
    marcadores = {'ESTOQUE', 'PLANEJADO', 'COMPRADO', 'RECEBIDO', 'REAL', 'SALDO'}
    for indice, linha in enumerate(linhas):
        cabecalho = {_normalizar(valor) for valor in linha}
        if 'PLANEJADO' in cabecalho and len(cabecalho & marcadores) >= 3:
            return indice, linha
    raise ValueError('Tabela-resumo do MRP não encontrada')


def _valor_historico(valor):
    if isinstance(valor, (datetime, date)):
        return valor.isoformat()
    return valor


def materiais_da_planilha(caminho):
    arquivo = load_workbook(caminho, read_only=True, data_only=True)
    materiais = []
    for nome_aba in arquivo.sheetnames:
        linhas = [list(linha) for linha in arquivo[nome_aba].iter_rows(values_only=True)]
        historico = [[_valor_historico(valor) for valor in linha] for linha in linhas]
        indice_cabecalho, cabecalho = _linha_resumo(linhas)
        colunas = {_normalizar(valor): indice for indice, valor in enumerate(cabecalho)}
        coluna_estoque = colunas.get('ESTOQUE')
        coluna_planejado = colunas['PLANEJADO']
        coluna_comprado = next(colunas[nome] for nome in ('RECEBIDO', 'COMPRADO', 'REAL') if nome in colunas)
        for linha in linhas[indice_cabecalho + 1:]:
            nome_material = str(linha[0]).strip() if linha and linha[0] is not None else ''
            planejado = _numero(linha[coluna_planejado] if coluna_planejado < len(linha) else None)
            if not nome_material:
                break
            if _normalizar(nome_material) in {'COMPRA', 'COMPRAS'}:
                continue
            if planejado == 0 and not any(_numero(linha[coluna] if coluna < len(linha) else None) != 0 for coluna in (coluna_estoque, coluna_comprado) if coluna is not None):
                continue
            nome = f'{nome_aba} - {nome_material}'
            nome = nome.replace('MOLETOM STELLANTIS - MOLETOM ', 'MOLETOM STELLANTIS - ')
            nome = nome.replace('MOLETOM PAUSADO - MOLETOM ', 'MOLETOM PAUSADO - ')
            nome = nome.replace('TEKSID - CAMISA - ', 'TEKSID CAMISA - ')
            nome = nome.replace('TEKSID - CALÇA - ', 'TEKSID CALÇA - ')
            nome = {'MOLETOM MARINHO - MOLETOM MARINHO': 'MOLETOM MARINHO - CASACO', 'MOLETOM MESCLA - MOLETOM MESCLA': 'MOLETOM MESCLA - CASACO', 'PIQUET MARINHO - PIQUET MARINHO': 'PIQUET MARINHO - GERAL', 'PIQUET OURO - PIQUET OURO': 'PIQUET OURO'}.get(nome, nome)
            consumo = CONSUMOS.get(nome)
            if consumo is None:
                raise ValueError(f'Consumo não definido para {nome}')
            materiais.append({'nome': nome, 'estoque': _numero(linha[coluna_estoque]) if coluna_estoque is not None else 0.0, 'consumo': consumo, 'demanda': planejado / consumo, 'comprado': _numero(linha[coluna_comprado]), 'aba': nome_aba, 'historico': historico})
    quantidade_abas = len(arquivo.sheetnames)
    arquivo.close()
    return materiais, quantidade_abas


def seed_materiais():
    caminho = os.path.join(os.path.dirname(__file__), 'Compra de Materiais.xlsx')
    materiais, quantidade_abas = materiais_da_planilha(caminho)
    if quantidade_abas != 21 or len(materiais) != len(CONSUMOS):
        raise ValueError(f'Planilha do MRP incompleta: {quantidade_abas} abas e {len(materiais)} materiais.')
    with app.app_context():
        db.session.query(MaterialPlanejamento).delete()
        for material in materiais:
            db.session.add(MaterialPlanejamento(nome=material['nome'], estoque_atual=material['estoque'], consumo_por_peca=material['consumo'], demanda_pecas=material['demanda'], comprado_recebido=material['comprado'], planilha_aba=material['aba'], planilha_nome=os.path.basename(caminho), historico_planilha=json.dumps(material['historico'], ensure_ascii=False)))
        db.session.commit()
        print(f'Banco de dados MRP populado com {len(materiais)} materiais de {quantidade_abas} abas.')
