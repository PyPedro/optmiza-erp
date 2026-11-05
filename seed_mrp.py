import os
import unicodedata

from openpyxl import load_workbook

from app import app, db
from app.models import MaterialPlanejamento

from mrp_import import seed_materiais as seed_materiais_planilha
import os
from app import app, db
from app.models import MaterialPlanejamento

def seed_materiais_legado():
    with app.app_context():
        print("Iniciando a alimentação do banco de dados MRP...")
        
        # 1. Apaga os dados antigos com segurança
        try:
            num_deletados = db.session.query(MaterialPlanejamento).delete()
            print(f"Limpeza concluída: {num_deletados} registros antigos removidos.")
        except Exception as e:
            db.session.rollback()
            print(f"Erro ao limpar banco: {e}")
            return
            
        # 2. Lista de dados iniciais
        iniciais = [
            {'nome': 'Firantela - Estampado', 'estoque': 0.0, 'consumo': 0.165, 'demanda': 157739.06, 'comprado': 26700.0},
            {'nome': 'Firantela - Liso', 'estoque': 0.0, 'consumo': 0.165, 'demanda': 92708.94, 'comprado': 15500.0},
            {'nome': 'Monet - Estampado', 'estoque': 0.0, 'consumo': 0.165, 'demanda': 125696.28, 'comprado': 21083.51},
            {'nome': 'Monet - Liso', 'estoque': 0.0, 'consumo': 0.165, 'demanda': 87285.57, 'comprado': 14696.34},
            {'nome': 'ARAZUL - Estampado', 'estoque': 0.0, 'consumo': 0.165, 'demanda': 87818.68, 'comprado': 14529.5},
            {'nome': 'ARAZUL - Liso', 'estoque': 0.0, 'consumo': 0.165, 'demanda': 48503.3, 'comprado': 8833.7},
            {'nome': 'SUNFLOWER - Estampado', 'estoque': 0.0, 'consumo': 0.165, 'demanda': 92575.08, 'comprado': 15271.49},
            {'nome': 'SUNFLOWER - Liso', 'estoque': 0.0, 'consumo': 0.165, 'demanda': 60709.25, 'comprado': 10641.4},
            {'nome': 'PURISME - Estampado', 'estoque': 0.0, 'consumo': 0.165, 'demanda': 161531.2, 'comprado': 27900.12},
            {'nome': 'PURISME - Liso', 'estoque': 0.0, 'consumo': 0.165, 'demanda': 117730.12, 'comprado': 18842.16},
            {'nome': 'BLUEDREAM - Estampado', 'estoque': 0.0, 'consumo': 0.165, 'demanda': 116376.41, 'comprado': 20160.34},
            {'nome': 'BLUEDREAM - Liso', 'estoque': 0.0, 'consumo': 0.165, 'demanda': 67863.99, 'comprado': 11497.9},
            {'nome': 'APRICOT - Estampado', 'estoque': 0.0, 'consumo': 0.165, 'demanda': 106119.41, 'comprado': 18152.52},
            {'nome': 'APRICOT - Liso', 'estoque': 0.0, 'consumo': 0.165, 'demanda': 65902.62, 'comprado': 11157.71},
            {'nome': 'VERÃO - PV CINZA', 'estoque': 48.0, 'consumo': 0.22, 'demanda': 8050.0, 'comprado': 1999.2},
            {'nome': 'VERÃO - RIBANA MARINHO', 'estoque': 0.0, 'consumo': 0.008, 'demanda': 8050.0, 'comprado': 79.38},
            {'nome': 'CAMISA - Piquet', 'estoque': 247.23, 'consumo': 1.0, 'demanda': 107867.02, 'comprado': 103873.91},
            {'nome': 'MOLETOM STELLANTIS - MARINHO', 'estoque': 120.0, 'consumo': 0.36, 'demanda': 7124.0, 'comprado': 2410.31},
            {'nome': 'MOLETOM STELLANTIS - MESCLA', 'estoque': 220.0, 'consumo': 0.11, 'demanda': 7124.0, 'comprado': 550.0},
            {'nome': 'STELLANTIS CALÇAS - Terbrim', 'estoque': 557.2, 'consumo': 1.27, 'demanda': 242101.0, 'comprado': 301325.2},
            {'nome': 'WHIRLPOOL CALÇAS - Twill', 'estoque': 7711.0, 'consumo': 1.3, 'demanda': 49345.0, 'comprado': 58194.3},
            {'nome': 'PATÊ STELLANTIS - PIQUET MARINHO', 'estoque': 0.0, 'consumo': 0.01, 'demanda': 35410.0, 'comprado': 0.0},
            {'nome': 'TEKSID - TAPÉ', 'estoque': 0.0, 'consumo': 1.0, 'demanda': 15230.4, 'comprado': 18027.9},
            {'nome': 'TEKSID - SOLASOL', 'estoque': 0.0, 'consumo': 1.0, 'demanda': 15852.6, 'comprado': 16220.0},
            {'nome': 'TEKSID CAMISA - TAPÉ', 'estoque': 0.0, 'consumo': 1.14, 'demanda': 6800.0, 'comprado': 8397.6},
            {'nome': 'TEKSID CALÇA - SOLASOL', 'estoque': 0.0, 'consumo': 1.26, 'demanda': 6540.0, 'comprado': 8684.4},
            {'nome': 'MOLETOM MARINHO - CASACO', 'estoque': 257.73, 'consumo': 0.36, 'demanda': 13530.0, 'comprado': 5000.0},
            {'nome': 'MOLETOM MESCLA - CASACO', 'estoque': 162.3, 'consumo': 0.11, 'demanda': 13420.0, 'comprado': 5000.0},
            {'nome': 'MOLETOM PAUSADO - MARINHO', 'estoque': 257.73, 'consumo': 0.36, 'demanda': 19300.0, 'comprado': 9737.61},
            {'nome': 'MOLETOM PAUSADO - MESCLA', 'estoque': 162.3, 'consumo': 0.11, 'demanda': 19300.0, 'comprado': 2679.16},
            {'nome': 'PIQUET MARINHO - GERAL', 'estoque': 139.43, 'consumo': 1.0, 'demanda': 0.0, 'comprado': 768.18},
            {'nome': 'PIQUET OURO', 'estoque': 358.0, 'consumo': 1.0, 'demanda': 0.0, 'comprado': 0.0}
        ]
        
        # 3. Insere os novos dados
        try:
            print(f"Inserindo {len(iniciais)} materiais...")
            for m in iniciais:
                db.session.add(MaterialPlanejamento(
                    nome=m['nome'], 
                    estoque_atual=m['estoque'], 
                    consumo_por_peca=m['consumo'], 
                    demanda_pecas=m['demanda'], 
                    comprado_recebido=m['comprado']
                ))
            db.session.commit()
            print("✅ Banco de dados MRP populado com sucesso!")
        except Exception as e:
            db.session.rollback()
            print(f"Erro ao popular banco: {e}")

if __name__ == '__main__':
    seed_materiais_planilha()