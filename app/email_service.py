import hashlib
import os
import secrets
import smtplib
from datetime import datetime, timedelta
from email.message import EmailMessage
from urllib.parse import urljoin


def gerar_token_confirmacao():
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode('utf-8')).hexdigest()
    expira_em = datetime.utcnow() + timedelta(hours=24)
    return token, token_hash, expira_em


def hash_token_confirmacao(token):
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def enviar_email_confirmacao(destinatario, nome, token):
    host = os.getenv('SMTP_HOST')
    usuario = os.getenv('SMTP_USER')
    senha = os.getenv('SMTP_PASSWORD')
    remetente = os.getenv('MAIL_FROM') or usuario
    base_url = os.getenv('APP_BASE_URL', 'http://localhost:5000/').rstrip('/') + '/'
    link = urljoin(base_url, f'confirmar-email/{token}')

    if not all((host, usuario, senha, remetente)):
        print(f"⚠️ [AVISO] SMTP não configurado. Email não enviado para {destinatario}.")
        print(f"🔗 Simulação do Link de confirmação: {link}")
        return False 

    mensagem = EmailMessage()
    mensagem['Subject'] = 'Confirme seu e-mail - Optmiza Compras'
    mensagem['From'] = remetente
    mensagem['To'] = destinatario
    mensagem.set_content(
        f'Olá, {nome}!\n\n'
        f'Confirme seu e-mail para ativar seu acesso ao Optmiza Compras:\n{link}\n\n'
        'Este link expira em 24 horas.'
    )

    porta = int(os.getenv('SMTP_PORT', '587'))
    
    try:
        if porta == 465:
            with smtplib.SMTP_SSL(host, porta, timeout=20) as servidor:
                servidor.login(usuario, senha)
                servidor.send_message(mensagem)
        else:
            with smtplib.SMTP(host, porta, timeout=20) as servidor:
                servidor.ehlo()
                servidor.starttls()
                servidor.ehlo()
                servidor.login(usuario, senha)
                servidor.send_message(mensagem)
        return True
    except Exception as e:
        print(f"❌ [ERRO] Falha na conexão com o servidor SMTP: {e}")
        return False