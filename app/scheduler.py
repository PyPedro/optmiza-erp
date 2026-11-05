from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from datetime import datetime, timedelta
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def verificar_pedidos_atrasados(app):
    from app.models import PedidoCompra
    from app.extensions import db
    
    with app.app_context():
        hoje = datetime.utcnow()
        pedidos_ativos = PedidoCompra.query.filter(
            PedidoCompra.status.in_(['gerado', 'aprovado', 'transito'])
        ).all()
        
        atrasados = []
        for po in pedidos_ativos:
            limite = po.data_emissao + timedelta(days=po.prazo_dias or 7)
            if hoje > limite:
                atrasados.append(po)
                
        if atrasados:
            logger.info(f"[ALERTA PCP] Foram encontrados {len(atrasados)} pedidos ATRASADOS!")
            for po in atrasados:
                nome_item = po.item_nome if po.item_nome else (po.solicitacao.item if po.solicitacao else "N/A")
                logger.warning(f" - PO-{500 + po.id}: {nome_item} (Fornecedor: {po.fornecedor}) está atrasado.")
        else:
            logger.info("[ALERTA PCP] Nenhum pedido de compra atrasado hoje. Tudo no prazo.")

def enviar_resumo_motorista(app):
    from app.models import RotaMotorista
    from app.extensions import db
    
    with app.app_context():
        hoje_str = datetime.now().strftime("%Y-%m-%d")
        rotas_hoje = RotaMotorista.query.filter_by(status='pendente', data_prevista=hoje_str).all()
        
        if rotas_hoje:
            logger.info(f"[LOGÍSTICA] Resumo diário para o Motorista: {len(rotas_hoje)} coletas agendadas para hoje.")
            for rota in rotas_hoje:
                logger.info(f" - Destino: {rota.destino_fornecedor} | Ref: {rota.po_ref} | Motorista: {rota.motorista}")
        else:
            logger.info("[LOGÍSTICA] Nenhuma coleta pendente agendada para hoje.")


def start_scheduler(app):
    scheduler = BackgroundScheduler(daemon=True)
    scheduler.add_job(
        func=verificar_pedidos_atrasados, 
        trigger=CronTrigger(hour=5, minute=0), 
        args=[app], 
        id='job_pedidos_atrasados',
        replace_existing=True
    )
    scheduler.add_job(
        func=enviar_resumo_motorista, 
        trigger=CronTrigger(hour=5, minute=30), 
        args=[app], 
        id='job_rotas_motorista',
        replace_existing=True
    )
    scheduler.start()
    logger.info("APScheduler iniciado! Rotinas de madrugada ativadas.")