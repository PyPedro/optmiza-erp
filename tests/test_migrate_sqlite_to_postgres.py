from datetime import datetime

import pytest
from sqlalchemy import Boolean, Column, DateTime, Integer, MetaData, String, Table, create_engine, select, text
from sqlalchemy.dialects import postgresql

from app import _postgres_missing_column_statement
from scripts.migrate_sqlite_to_postgres import (
    copy_source_table,
    get_postgres_url,
    normalize_value,
    validate_bootstrap_only,
)


def test_postgres_missing_column_ddl_uses_postgresql_boolean_default():
    column = Column('email_confirmado', Boolean, nullable=False, server_default=text('true'))
    table = Table('usuario', MetaData(), Column('id', Integer, primary_key=True), column)

    statement = _postgres_missing_column_statement(table, column, postgresql.dialect())

    assert statement == (
        'ALTER TABLE usuario ADD COLUMN email_confirmado BOOLEAN DEFAULT true NOT NULL'
    )


def test_normalize_value_converts_sqlite_boolean_and_datetime():
    assert normalize_value(1, Column('ativo', Boolean)) is True
    assert normalize_value(
        '2026-11-05 09:00:00',
        Column('criado_em', DateTime),
    ) == datetime(2026, 11, 5, 9)


@pytest.mark.parametrize(
    ('database_url', 'expected'),
    [
        ('postgres://user:pass@host/database', 'postgresql+psycopg://user:pass@host/database'),
        ('postgresql://user:pass@host/database', 'postgresql+psycopg://user:pass@host/database'),
        ('postgresql+psycopg://user:pass@host/database', 'postgresql+psycopg://user:pass@host/database'),
    ],
)
def test_get_postgres_url_normalizes_render_url(monkeypatch, database_url, expected):
    monkeypatch.setenv('DATABASE_URL', database_url)
    assert get_postgres_url() == expected


def test_copy_source_table_preserves_ids_and_normalizes_boolean_values():
    source_engine = create_engine('sqlite://')
    destination_engine = create_engine('sqlite://')
    source_metadata = MetaData()
    destination_metadata = MetaData()
    source_table = Table(
        'usuario',
        source_metadata,
        Column('id', Integer, primary_key=True),
        Column('email', String, nullable=False),
        Column('ativo', Boolean, nullable=False),
    )
    target_table = Table(
        'usuario',
        destination_metadata,
        Column('id', Integer, primary_key=True),
        Column('email', String, nullable=False),
        Column('ativo', Boolean, nullable=False),
    )
    source_metadata.create_all(source_engine)
    destination_metadata.create_all(destination_engine)

    with source_engine.begin() as connection:
        connection.execute(source_table.insert(), [
            {'id': 42, 'email': 'usuario@example.com', 'ativo': 1},
        ])
    with source_engine.connect() as source_connection, destination_engine.begin() as destination_connection:
        copied = copy_source_table(
            source_connection,
            destination_connection,
            source_table,
            target_table,
        )

    with destination_engine.connect() as connection:
        row = connection.execute(select(target_table)).one()
    assert copied == 1
    assert row.id == 42
    assert row.ativo is True


def test_validate_bootstrap_only_rejects_production_records():
    engine = create_engine('sqlite://')
    metadata = MetaData()
    user_table = Table(
        'usuario',
        metadata,
        Column('email', String, primary_key=True),
    )
    role_table = Table(
        'nivel_acesso',
        metadata,
        Column('nome', String, primary_key=True),
    )
    request_table = Table('solicitacao_compra', metadata, Column('id', Integer, primary_key=True))
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(request_table.insert(), {'id': 1})
        counts = {'usuario': 0, 'nivel_acesso': 0, 'solicitacao_compra': 1}
        with pytest.raises(RuntimeError, match='sobrescrever dados'):
            validate_bootstrap_only(
                connection,
                counts,
                {
                    'usuario': user_table,
                    'nivel_acesso': role_table,
                    'solicitacao_compra': request_table,
                },
            )
