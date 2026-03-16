# PostgreSQL via Docker

## Arquivos criados
- `docker-compose.yml`
- `.env`
- `.env.example`

## Subir banco
No diretório do projeto:

```bash
docker compose up -d
```

## Verificar status

```bash
docker compose ps
docker compose logs -f postgres
```

## Testar conexão

```bash
docker compose exec postgres psql -U postgres -d smartshop_recommender -c "SELECT NOW();"
```

## Resetar banco (apaga dados)

```bash
docker compose down -v
docker compose up -d
```

## Observação importante
Os scripts em `db/schema.sql` e `db/seed.sql` são executados automaticamente apenas na primeira inicialização do volume `postgres_data`.
Se você alterar os scripts e quiser reaplicar do zero, use `docker compose down -v`.
