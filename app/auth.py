from datetime import datetime
from flask import Blueprint, render_template, redirect, url_for, request, flash, jsonify
from flask_login import login_user, logout_user, login_required, current_user
from app.models import Usuario
from app.extensions import db
from app.email_service import hash_token_confirmacao

auth_bp = Blueprint('auth', __name__)

@auth_bp.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
        
    if request.method == 'POST':
        # Captura os dados com segurança máxima
        email = request.form.get('email') or (request.json.get('email') if request.is_json else None)
        senha = request.form.get('senha') or request.form.get('password') or (request.json.get('senha') if request.is_json else None)
        
        # Proteção contra NoneType: Se a senha ou e-mail vierem vazios, avisa na tela em vez de quebrar
        if not email or not senha:
            flash('Preencha o e-mail e a senha corretamente.', 'danger')
            return render_template('login.html')
            
        usuario = Usuario.query.filter_by(email=email).first()
        
        if usuario and usuario.verificar_senha(senha):
            login_user(usuario)
            if request.is_json:
                return jsonify({"mensagem": "Login realizado com sucesso", "redirect": url_for('index')}), 200
            return redirect(url_for('index'))
        
        if request.is_json:
            return jsonify({"erro": "E-mail ou senha inválidos"}), 401
            
        flash('E-mail ou senha inválidos.', 'danger')
        
    return render_template('login.html')

@auth_bp.route('/confirmar-email/<token>')
def confirmar_email(token):
    usuario = Usuario.query.filter_by(email_confirmacao_token_hash=hash_token_confirmacao(token)).first()
    if not usuario or not usuario.email_confirmacao_expira_em or usuario.email_confirmacao_expira_em < datetime.utcnow():
        return render_template('confirmacao_email.html', sucesso=False, mensagem='Este link é inválido ou expirou.'), 400

    usuario.email_confirmado = True
    usuario.email_confirmacao_token_hash = None
    usuario.email_confirmacao_expira_em = None
    db.session.commit()
    return render_template('confirmacao_email.html', sucesso=True, mensagem='E-mail confirmado com sucesso. Você já pode entrar no sistema.')

@auth_bp.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('auth.login'))