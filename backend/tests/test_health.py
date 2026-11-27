async def test_health_reports_db_ok(client):
    res = await client.get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "db": "ok"}
