from types import SimpleNamespace
import json

from app.api.compras_api import extrair_comando_adicionar_item, extrair_comando_receber_itens, extrair_comando_remover_item, normalizar_lista_itens, resolver_setor_solicitante
from app.services.compras_service import _atualizar_status_itens_aprovados, _montar_itens_pedido


def test_extrair_comando_adicionar_item_aceita_codigo_com_ou_sem_aspas():
    assert extrair_comando_adicionar_item('/ADD "MAT-001"') == 'MAT-001'
    assert extrair_comando_adicionar_item('/add MAT-002') == 'MAT-002'
    assert extrair_comando_adicionar_item('comentário comum') is None


def test_extrair_comando_remover_item_aceita_codigo_com_ou_sem_aspas():
    assert extrair_comando_remover_item('/REMOVE "MAT-001"') == 'MAT-001'
    assert extrair_comando_remover_item('/remove MAT-002') == 'MAT-002'
    assert extrair_comando_remover_item('comentário comum') is None


def test_extrair_comando_receber_itens_aceita_varios_codigos():
    assert extrair_comando_receber_itens('/receber "MAT-001" "MAT-002"') == ['MAT-001', 'MAT-002']
    assert extrair_comando_receber_itens('/RECEBER MAT-003,MAT-004') == ['MAT-003', 'MAT-004']
    assert extrair_comando_receber_itens('comentário comum') is None


def test_normalizar_lista_itens_aceita_varias_entradas():
    assert normalizar_lista_itens("Pino A; Pino B; Pino C") == [
        {"item": "Pino A", "quantidade": 1.0},
        {"item": "Pino B", "quantidade": 1.0},
        {"item": "Pino C", "quantidade": 1.0},
    ]

    assert normalizar_lista_itens([
        {"item": "Parafuso", "quantidade": 4},
        {"item": "Porca", "quantidade": 2}
    ]) == [
        {"item": "Parafuso", "quantidade": 4.0},
        {"item": "Porca", "quantidade": 2.0},
    ]


def test_resolver_setor_solicitante_usa_usuario_quando_setor_nao_informado():
    usuario = SimpleNamespace(nome="Maria Silva")

    assert resolver_setor_solicitante("", usuario) == "Maria Silva"
    assert resolver_setor_solicitante(None, usuario) == "Maria Silva"
    assert resolver_setor_solicitante("PCP", usuario) == "PCP"


def test_aprovacao_parcial_mantem_demais_itens_pendentes():
    solicitacao = SimpleNamespace(
        item="Item A; Item B",
        quantidade=2,
        itens_detalhados=json.dumps([
            {"item": "Item A", "quantidade": 1, "status": "pendente"},
            {"item": "Item B", "quantidade": 1, "status": "pendente"},
        ]),
        status="cotacao",
    )
    cotacao = SimpleNamespace(itens_cotacao=json.dumps([{"item": "Item A"}]))

    _atualizar_status_itens_aprovados(solicitacao, cotacao)

    itens = json.loads(solicitacao.itens_detalhados)
    assert [item["status"] for item in itens] == ["aprovado", "pendente"]
    assert solicitacao.status == "cotacao"


def test_itens_pedido_preserva_quantidades_solicitadas_e_cotadas():
    solicitacao = SimpleNamespace(
        item="Item A; Item B",
        quantidade=8,
        itens_detalhados=json.dumps([
            {"item": "Item A", "quantidade": 5, "status": "pendente"},
            {"item": "Item B", "quantidade": 3, "status": "pendente"},
        ]),
    )
    cotacao = SimpleNamespace(itens_cotacao=json.dumps([
        {"item": "Item A", "quantidade": 4, "unidade": "UN"},
        {"item": "Item B", "quantidade": 3, "unidade": "KG"},
    ]))

    itens = _montar_itens_pedido(solicitacao, cotacao)

    assert itens == [
        {
            "item": "Item A",
            "quantidade_solicitada": 5,
            "quantidade_pedida": 4,
            "incluido_no_pedido": True,
            "unidade": "UN",
            "valor_unitario": None,
            "valor_total": None,
        },
        {
            "item": "Item B",
            "quantidade_solicitada": 3,
            "quantidade_pedida": 3,
            "incluido_no_pedido": True,
            "unidade": "KG",
            "valor_unitario": None,
            "valor_total": None,
        },
    ]


def test_pedido_lista_todos_itens_da_solicitacao_mesmo_se_cotou_um():
    solicitacao = SimpleNamespace(
        item="Item A; Item B; Item C",
        quantidade=10,
        itens_detalhados=json.dumps([
            {"item": "Item A", "quantidade": 5},
            {"item": "Item B", "quantidade": 3},
            {"item": "Item C", "quantidade": 2},
        ]),
    )
    cotacao = SimpleNamespace(itens_cotacao=json.dumps([
        {"item": "Item B", "quantidade": 2, "unidade": "UN"},
    ]))

    itens = _montar_itens_pedido(solicitacao, cotacao)

    assert [item["item"] for item in itens] == ["Item A", "Item B", "Item C"]
    assert [item["quantidade_solicitada"] for item in itens] == [5, 3, 2]
    assert [item["quantidade_pedida"] for item in itens] == [None, 2, None]
    assert [item["incluido_no_pedido"] for item in itens] == [False, True, False]
