import argparse
import os
import sys
from datetime import date, datetime
from pathlib import Path

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    MetaData,
    Table,
    create_engine,
    delete,
    func,
    inspect,
    select,
    text,
)
from sqlalchemy.engine import URL


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
DEFAULT_SOURCE = ROOT / 'compras.db'
BOOTSTRAP_ROLES = {
    'solicitante', 'estoque', 'comercial', 'comprador', 'gerente', 'admin'
}
BOOTSTRAP_ADMIN = 'pedro@pcp.com'
BATCH_SIZE = 500


def parse_args():
    parser = argparse.ArgumentParser(
        description='Copia os dados do SQLite local para um PostgreSQL vazio do Render.'
    )
    parser.add_argument(
        '--source',
        type=Path,
        default=DEFAULT_SOURCE,
        help=f'Arquivo SQLite de origem (padrão: {DEFAULT_SOURCE})',
    )
    parser.add_argument(
        '--apply',
        action='store_true',
        help='Executa a migração. Sem esta opção, apenas valida e mostra as contagens.',
    )
    return parser.parse_args()


def get_postgres_url():
    database_url = os.environ.get('DATABASE_URL')
    if not database_url:
        raise RuntimeError('Defina DATABASE_URL com a URL externa do PostgreSQL do Render.')
    if database_url.startswith('postgres://'):
        database_url = database_url.replace('postgres://', 'postgresql+psycopg://', 1)
    elif database_url.startswith('postgresql://'):
        database_url = database_url.replace('postgresql://', 'postgresql+psycopg://', 1)
    if not database_url.startswith('postgresql+psycopg://'):
        raise RuntimeError('DATABASE_URL precisa apontar para PostgreSQL.')
    return database_url


def normalize_value(value, column):
    if value is None:
        return None
    if isinstance(column.type, Boolean):
        return bool(value)
    if isinstance(column.type, DateTime) and isinstance(value, str):
        return datetime.fromisoformat(value)
    if isinstance(column.type, Date) and isinstance(value, str):
        return date.fromisoformat(value)
    return value


def get_table_counts(connection, tables):
    return {
        name: connection.execute(select(func.count()).select_from(table)).scalar_one()
        for name, table in tables.items()
    }


def validate_bootstrap_only(connection, counts, target_tables):
    for table_name, count in counts.items():
        if not count:
            continue
        if table_name not in {'usuario', 'nivel_acesso'}:
            raise RuntimeError(
                f'O PostgreSQL já contém {count} registro(s) em {table_name}; '
                'migração cancelada para não sobrescrever dados.'
            )

    users = target_tables['usuario']
    if counts.get('usuario'):
        emails = {
            row[0].strip().lower()
            for row in connection.execute(select(users.c.email))
        }
        if emails != {BOOTSTRAP_ADMIN}:
            raise RuntimeError(
                'O PostgreSQL contém usuários além do administrador inicial; '
                'migração cancelada.'
            )

    roles = target_tables['nivel_acesso']
    if counts.get('nivel_acesso'):
        names = {
            row[0]
            for row in connection.execute(select(roles.c.nome))
        }
        if not names.issubset(BOOTSTRAP_ROLES):
            raise RuntimeError(
                'O PostgreSQL contém níveis de acesso não reconhecidos; '
                'migração cancelada.'
            )


def copy_source_table(source_connection, destination_connection, source_table, target_table):
    target_columns = set(target_table.c.keys())
    source_columns = set(source_table.c.keys())
    extra_columns = source_columns - target_columns
    if extra_columns:
        raise RuntimeError(
            f'A tabela {source_table.name} tem colunas sem destino: '
            f'{", ".join(sorted(extra_columns))}.'
        )

    result = source_connection.execute(select(source_table))
    copied = 0
    while True:
        rows = result.fetchmany(BATCH_SIZE)
        if not rows:
            break
        batch = [
            {
                column_name: normalize_value(row._mapping[column_name], target_table.c[column_name])
                for column_name in source_columns
            }
            for row in rows
        ]
        destination_connection.execute(target_table.insert(), batch)
        copied += len(batch)
    return copied


def reset_sequences(connection, tables):
    for table in tables:
        primary_key = table.autoincrement_column
        if primary_key is None:
            continue

        sequence = connection.execute(
            text('SELECT pg_get_serial_sequence(:table_name, :column_name)'),
            {'table_name': table.name, 'column_name': primary_key.name},
        ).scalar_one_or_none()
        if not sequence:
            continue

        last_id = connection.execute(
            select(func.max(table.c[primary_key.name]))
        ).scalar_one()
        if last_id is not None:
            connection.execute(
                text('SELECT setval(CAST(:sequence AS regclass), :last_id, true)'),
                {'sequence': sequence, 'last_id': last_id},
            )


def main():
    args = parse_args()
    source_path = args.source.resolve()
    if not source_path.is_file():
        raise RuntimeError(f'Banco SQLite não encontrado: {source_path}')

    postgres_url = get_postgres_url()
    original_database_url = os.environ.get('DATABASE_URL')
    os.environ['DATABASE_URL'] = 'sqlite:///:memory:'
    os.environ['SKIP_FORMACAO_PRECOS_IMPORT'] = '1'
    try:
        from app import db
    finally:
        if original_database_url is None:
            os.environ.pop('DATABASE_URL', None)
        else:
            os.environ['DATABASE_URL'] = original_database_url

    source_engine = create_engine(URL.create('sqlite', database=str(source_path)))
    destination_engine = create_engine(postgres_url, pool_pre_ping=True)
    try:
        model_tables = db.metadata.sorted_tables
        model_table_names = {table.name for table in model_tables}
        source_table_names = set(inspect(source_engine).get_table_names())
        unknown_source_tables = source_table_names - model_table_names
        if unknown_source_tables:
            raise RuntimeError(
                'O SQLite contém tabelas não reconhecidas pelo modelo atual: '
                f'{", ".join(sorted(unknown_source_tables))}.'
            )

        destination_inspector = inspect(destination_engine)
        destination_table_names = set(destination_inspector.get_table_names())
        unknown_destination_tables = destination_table_names - model_table_names
        if unknown_destination_tables:
            raise RuntimeError(
                'O PostgreSQL contém tabelas fora do modelo da aplicação: '
                f'{", ".join(sorted(unknown_destination_tables))}.'
            )
        missing_tables = model_table_names - destination_table_names
        if missing_tables:
            raise RuntimeError(
                'O PostgreSQL ainda não tem o esquema da aplicação. '
                'Faça o deploy do app e tente novamente. Tabelas ausentes: '
                f'{", ".join(sorted(missing_tables))}.'
            )

        source_metadata = MetaData()
        destination_metadata = MetaData()
        source_tables = {
            name: Table(name, source_metadata, autoload_with=source_engine)
            for name in sorted(source_table_names)
        }
        destination_tables = {
            name: Table(name, destination_metadata, autoload_with=destination_engine)
            for name in sorted(model_table_names)
        }

        with (
            source_engine.connect() as source_connection,
            destination_engine.connect() as destination_connection,
        ):
            source_counts = get_table_counts(source_connection, source_tables)
            destination_counts = get_table_counts(destination_connection, destination_tables)
            validate_bootstrap_only(
                destination_connection,
                destination_counts,
                destination_tables,
            )

            print('Registros na origem SQLite:')
            for table_name in sorted(source_counts):
                print(f'  {table_name}: {source_counts[table_name]}')

            if not args.apply:
                print('\nPrévia concluída. Nenhum dado foi alterado.')
                print('Revise as contagens e execute novamente com --apply para migrar.')
                return

        with destination_engine.begin() as destination_connection:
            quoted_tables = ', '.join(
                destination_engine.dialect.identifier_preparer.quote(table.name)
                for table in model_tables
            )
            destination_connection.exec_driver_sql(
                f'LOCK TABLE {quoted_tables} IN ACCESS EXCLUSIVE MODE'
            )
            current_counts = get_table_counts(destination_connection, destination_tables)
            validate_bootstrap_only(
                destination_connection,
                current_counts,
                destination_tables,
            )

            for table in reversed(model_tables):
                destination_connection.execute(delete(destination_tables[table.name]))

            copied_counts = {}
            with source_engine.connect() as source_connection:
                for table in model_tables:
                    source_table = source_tables.get(table.name)
                    if source_table is None:
                        copied_counts[table.name] = 0
                        continue
                    copied_counts[table.name] = copy_source_table(
                        source_connection,
                        destination_connection,
                        source_table,
                        destination_tables[table.name],
                    )

            reset_sequences(destination_connection, model_tables)
            for table_name, source_count in source_counts.items():
                if copied_counts[table_name] != source_count:
                    raise RuntimeError(
                        f'Contagem divergente em {table_name}: origem={source_count}, '
                        f'destino={copied_counts[table_name]}.'
                    )

        print('\nMigração concluída:')
        for table_name in sorted(copied_counts):
            print(f'  {table_name}: {copied_counts[table_name]}')
        print('\nOs arquivos de uploads precisam ser transferidos separadamente.')
    finally:
        source_engine.dispose()
        destination_engine.dispose()


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'ERRO: {error}', file=sys.stderr)
        sys.exit(1)
