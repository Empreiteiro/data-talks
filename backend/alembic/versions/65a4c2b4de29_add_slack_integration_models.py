"""Add Slack integration models

Revision ID: 65a4c2b4de29
Revises: 20260316120000
Create Date: 2026-03-18 09:58:18.142239

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '65a4c2b4de29'
down_revision: Union[str, None] = '20260316120000'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('slack_bot_configs',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('name', sa.String(length=128), nullable=False),
        sa.Column('client_id', sa.String(length=128), nullable=False),
        sa.Column('client_secret', sa.String(length=256), nullable=False),
        sa.Column('signing_secret', sa.String(length=256), nullable=False),
        sa.Column('bot_token', sa.String(length=512), nullable=True),
        sa.Column('team_id', sa.String(length=64), nullable=True),
        sa.Column('team_name', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_table('slack_oauth_states',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('state', sa.String(length=64), nullable=False),
        sa.Column('config_id', sa.String(length=36), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_slack_oauth_states_state'), 'slack_oauth_states', ['state'], unique=True)
    op.create_table('slack_connections',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('agent_id', sa.String(length=36), nullable=False),
        sa.Column('slack_bot_config_id', sa.String(length=36), nullable=False),
        sa.Column('team_id', sa.String(length=64), nullable=True),
        sa.Column('channel_id', sa.String(length=64), nullable=False),
        sa.Column('channel_name', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_slack_connections_channel_id'), 'slack_connections', ['channel_id'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_slack_connections_channel_id'), table_name='slack_connections')
    op.drop_table('slack_connections')
    op.drop_index(op.f('ix_slack_oauth_states_state'), table_name='slack_oauth_states')
    op.drop_table('slack_oauth_states')
    op.drop_table('slack_bot_configs')
