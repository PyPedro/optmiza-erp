import os
import logging
from app import app, db
from app.scheduler import start_scheduler

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

if __name__ == '__main__':
    # Descobre o caminho real onde o arquivo run.py está localizado
    basedir = os.path.abspath(os.path.dirname(__file__))
    upload_dir = os.path.join(basedir, 'uploads')
    os.makedirs(upload_dir, exist_ok=True)

    with app.app_context():
        db.create_all()
        logger.info("✅ Banco de dados 'compras.db' verificado/criado com sucesso!")

    start_scheduler(app)

    PORT = 5099
    logger.info(f"🚀 Servidor Compras/PCP iniciando em http://localhost:{PORT} ...")
    app.run(host='0.0.0.0', port=PORT, debug=True, use_reloader=False)