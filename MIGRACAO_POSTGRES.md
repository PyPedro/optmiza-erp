# Migração do SQLite local para o PostgreSQL do Render

O aplicativo usa `DATABASE_URL` quando essa variável aponta para PostgreSQL e mantém
`compras.db` como padrão para desenvolvimento local. O comando de migração copia os
registros do SQLite para o PostgreSQL, preserva os IDs e ajusta as sequências.

## Preparar o Render

1. Configure a variável `DATABASE_URL` do serviço web com a URL **interna** do banco
   PostgreSQL do Render. Não publique essa URL nem a salve no repositório.
2. Configure também uma `SECRET_KEY` estável no serviço. Gere-a localmente com
   `python -c "import secrets; print(secrets.token_hex(32))"` e mantenha o valor
   somente nas variáveis privadas do Render.
3. Faça o deploy e confirme que o serviço inicia sem erros.
4. Configure um Persistent Disk no serviço, por exemplo montado em `/var/data`, e
   defina `UPLOAD_FOLDER=/var/data/uploads`. Isso mantém os anexos enviados depois
   do deploy; sem um disco persistente, o sistema de arquivos do serviço é efêmero.

## Migrar o banco

Execute os comandos abaixo no PowerShell, na pasta do projeto. Use a URL **externa**
do PostgreSQL para a conexão temporária a partir do computador local. A entrada da
URL não será exibida nem gravada no histórico do PowerShell:

```powershell
$secureUrl = Read-Host "URL externa do PostgreSQL do Render" -AsSecureString
$env:DATABASE_URL = [System.Net.NetworkCredential]::new("", $secureUrl).Password
python -m pip install -r requirements.txt
python scripts\migrate_sqlite_to_postgres.py
```

O primeiro comando do script é uma prévia: mostra quantos registros serão copiados
e não migra dados. O script recusa continuar se encontrar dados de produção além das
linhas iniciais de configuração (níveis de acesso e, quando existir, o administrador
inicial). Se a prévia estiver correta, execute:

```powershell
python scripts\migrate_sqlite_to_postgres.py --apply
```

Ao terminar, remova a URL da sessão:

```powershell
Remove-Item Env:DATABASE_URL
```

O script não apaga nem altera `compras.db`. Ele faz a cópia em uma transação e
interrompe a operação se detectar tabelas ou colunas que não consegue migrar.
Na inicialização, o app também completa colunas ausentes em tabelas PostgreSQL
vazias. Se uma coluna obrigatória estiver ausente numa tabela que já contém dados,
o app para com uma mensagem explícita em vez de inventar valores.

## Anexos já existentes

Os registros do banco incluem referências aos anexos, mas o script não transfere o
conteúdo de `uploads/`. Copie os arquivos locais para a pasta persistente configurada
no Render, preservando a subpasta `comercial` e os nomes dos arquivos. Faça isso por
um meio privado e seguro; não envie anexos ou banco ao GitHub. Depois da cópia, teste
os downloads no sistema. Novos uploads serão gravados no caminho definido por
`UPLOAD_FOLDER`.
