# Redis with Docker

The same setup is used on local development machines and the VPS.

## Start Redis

```bash
npm run redis:up
```

## Check Redis

```bash
npm run redis:ping
```

The expected response is `PONG`.

## View logs

```bash
npm run redis:logs
```

## Stop Redis

```bash
npm run redis:down
```

Stopping Redis keeps its data in the `formyfans-redis-data` Docker volume.

## Application environment

When the Node.js backend runs directly on the host machine, use:

```env
REDIS_URL=redis://127.0.0.1:6379
```

Docker publishes Redis only on the host loopback interface, so port `6379` is not exposed publicly on the VPS.
