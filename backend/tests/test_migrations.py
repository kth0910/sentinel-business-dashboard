import subprocess, sys
def test_alembic_upgrade_and_downgrade(test_database_url_env):
    for args in (["upgrade", "head"], ["downgrade", "base"], ["upgrade", "head"]):
        r = subprocess.run([sys.executable, "-m", "alembic", *args], env=test_database_url_env, capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
