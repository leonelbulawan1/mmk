from app.db import normalize_database_url


def test_host_style_urls_use_psycopg():
    neon = "postgresql://u:p@ep-x.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
    assert normalize_database_url(neon) == neon.replace("postgresql://", "postgresql+psycopg://", 1)
    assert normalize_database_url("postgres://u:p@h/db").startswith("postgresql+psycopg://u:p@h/db")


def test_other_urls_unchanged():
    for url in ("sqlite:///x.db", "postgresql+psycopg://u:p@h/db"):
        assert normalize_database_url(url) == url
