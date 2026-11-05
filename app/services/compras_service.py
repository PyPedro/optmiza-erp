# sistema_compras/app/services/compras_service.py
from app.models import SolicitacaoCompra, Cotacao, PedidoCompra
from app.extensions import db
from decimal import Decimal
import json


def _atualizar_status_itens_aprovados(sc, cotacao):
    try:
        itens = json.loads(sc.itens_detalhados or '[]')
    except (TypeError, ValueError):
        itens = []
    if not isinstance(itens, list) or not itens:
        itens = [{'item': sc.item, 'quantidade': sc.quantidade, 'status': 'pendente'}]

    try:
        itens_cotacao = json.loads(cotacao.itens_cotacao or '[]')
    except (TypeError, ValueError):
        itens_cotacao = []
    if not isinstance(itens_cotacao, list) or not itens_cotacao:
        itens_cotacao = [{'item': sc.item}]

    nomes_cotados = {
        str(item.get('item') or '').strip().casefold()
        for item in itens_cotacao if isinstance(item, dict)
    }
    nomes_cotados.discard('')
    encontrados = [
        item for item in itens
        if isinstance(item, dict)
        and str(item.get('item') or '').strip().casefold() in nomes_cotados
    ]
    nomes_encontrados = {
        str(item.get('item') or '').strip().casefold() for item in encontrados
    }
    if not nomes_cotados or nomes_encontrados != nomes_cotados:
        raise ValueError('A cotação contém itens que não pertencem à solicitação.')
    if any(item.get('status', 'pendente') != 'pendente' for item in encontrados):
        raise ValueError('Um ou mais itens desta cotação já foram aprovados.')

    for item in encontrados:
        item['status'] = 'aprovado'
    sc.itens_detalhados = json.dumps(itens, ensure_ascii=False)
    sc.status = 'aprovado' if all(
        item.get('status', 'pendente') != 'pendente'
        for item in itens if isinstance(item, dict)
    ) else 'cotacao'


def _montar_itens_pedido(sc, cotacao):
    try:
        itens_solicitados = json.loads(sc.itens_detalhados or '[]')
    except (TypeError, ValueError):
        itens_solicitados = []
    if not isinstance(itens_solicitados, list) or not itens_solicitados:
        itens_solicitados = [{'item': sc.item, 'quantidade': sc.quantidade}]

    solicitados_por_nome = {}
    for item in itens_solicitados:
        if not isinstance(item, dict):
            continue
        nome = str(item.get('item') or '').strip()
        if nome:
            solicitados_por_nome.setdefault(nome.casefold(), []).append(item)

    try:
        itens_cotacao = json.loads(cotacao.itens_cotacao or '[]')
    except (TypeError, ValueError):
        itens_cotacao = []
    if not isinstance(itens_cotacao, list) or not itens_cotacao:
        itens_cotacao = [{'item': sc.item, 'quantidade': sc.quantidade}]

    itens_cotados_por_nome = {}
    for item_cotado in itens_cotacao:
        if not isinstance(item_cotado, dict):
            continue
        nome = str(item_cotado.get('item') or '').strip()
        if not nome:
            continue
        solicitados = solicitados_por_nome.get(nome.casefold(), [])
        solicitado = solicitados.pop(0) if solicitados else {}
        itens_cotados_por_nome.setdefault(nome.casefold(), []).append({
            'item': nome,
            'quantidade_pedida': item_cotado.get('quantidade', solicitado.get('quantidade')),
            'unidade': item_cotado.get('unidade') or 'UN',
            'valor_unitario': item_cotado.get('valor_unitario_raw'),
            'valor_total': item_cotado.get('valor_total_raw')
        })

    itens_pedido = []
    for item_solicitado in itens_solicitados:
        if not isinstance(item_solicitado, dict):
            continue
        nome = str(item_solicitado.get('item') or '').strip()
        if not nome:
            continue
        itens_cotados = itens_cotados_por_nome.get(nome.casefold(), [])
        item_cotado = itens_cotados.pop(0) if itens_cotados else None
        itens_pedido.append({
            'item': nome,
            'quantidade_solicitada': item_solicitado.get('quantidade'),
            'quantidade_pedida': item_cotado.get('quantidade_pedida') if item_cotado else None,
            'incluido_no_pedido': item_cotado is not None,
            'unidade': item_cotado.get('unidade') if item_cotado else None,
            'valor_unitario': item_cotado.get('valor_unitario') if item_cotado else None,
            'valor_total': item_cotado.get('valor_total') if item_cotado else None
        })
    return itens_pedido


def aprovar_solicitacao_service(sc_id, cotacao_id):
    """
    Regra de negócio: Aprova a Solicitação de Compra e gera o Pedido de Compra (PO)
    com base na cotação vencedora selecionada.
    """
    sc = SolicitacaoCompra.query.get_or_404(sc_id)
    cotacao = Cotacao.query.filter_by(id=cotacao_id, solicitacao_id=sc.id).first()
    if not cotacao:
        raise ValueError('A cotação informada não pertence à solicitação selecionada.')
    
    try:
        if sc.status == 'cancelado':
            raise ValueError('A solicitação foi cancelada e não está disponível para aprovação.')
        _atualizar_status_itens_aprovados(sc, cotacao)
        itens_cotacao = json.loads(cotacao.itens_cotacao or '[]')
        quantidade_total = 0.0
        for item in itens_cotacao:
            if isinstance(item, dict):
                quantidade = item.get('quantidade')
                if quantidade is not None:
                    try:
                        quantidade_total += float(quantidade)
                    except (TypeError, ValueError):
                        pass
        if quantidade_total <= 0:
            quantidade_total = float(sc.quantidade or 0)

        novo_pedido = PedidoCompra(
            solicitacao_id=sc.id,
            item_nome='; '.join(item.get('item', '') for item in itens_cotacao) or sc.item,
            quantidade=quantidade_total,
            itens_pedido=json.dumps(_montar_itens_pedido(sc, cotacao), ensure_ascii=False),
            fornecedor=cotacao.fornecedor,
            valor_total=cotacao.valor_total or Decimal(str(sc.quantidade)) * cotacao.valor_unitario,
            prazo_dias=PedidoCompra.converter_prazo_dias(cotacao.prazo_entrega),
            status='gerado'
        )
        db.session.add(novo_pedido)
        db.session.flush()
        return novo_pedido
    except Exception as e:
        db.session.rollback()
        raise e