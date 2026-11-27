"""records, changes, applied_tx

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-27
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "records",
        sa.Column("tbl", sa.String(), nullable=False),
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("version", sa.BigInteger(), nullable=False),
        sa.Column("space_id", sa.String(), nullable=True),
        sa.Column("parent_id", sa.String(), nullable=True),
        sa.Column("parent_table", sa.String(), nullable=True),
        sa.Column("alive", sa.Boolean(), nullable=True),
        sa.Column("last_edited_time", sa.BigInteger(), nullable=True),
        sa.Column("data", postgresql.JSONB(), nullable=False),
        sa.PrimaryKeyConstraint("tbl", "id"),
    )
    op.create_index("ix_records_tbl_parent_id", "records", ["tbl", "parent_id"])
    op.create_index(
        "ix_records_tbl_space_id_last_edited_time", "records", ["tbl", "space_id", "last_edited_time"]
    )
    op.create_table(
        "changes",
        sa.Column("lsn", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("tbl", sa.String(), nullable=True),
        sa.Column("id", sa.String(), nullable=True),
        sa.Column("space_id", sa.String(), nullable=True),
        sa.Column("version", sa.BigInteger(), nullable=True),
        sa.Column("time", sa.BigInteger(), nullable=True),
        sa.PrimaryKeyConstraint("lsn"),
    )
    op.create_index("ix_changes_space_id_lsn", "changes", ["space_id", "lsn"])
    op.create_table(
        "applied_tx",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("at", sa.BigInteger(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("applied_tx")
    op.drop_index("ix_changes_space_id_lsn", table_name="changes")
    op.drop_table("changes")
    op.drop_index("ix_records_tbl_space_id_last_edited_time", table_name="records")
    op.drop_index("ix_records_tbl_parent_id", table_name="records")
    op.drop_table("records")
