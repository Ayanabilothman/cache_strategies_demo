# Caching Strategies Demo

A small, runnable Express + MongoDB + Redis project that teaches five caching
strategies side by side, using one shared use case: a product catalog.

## 1. Project Overview

**Use case:** an e-commerce product catalog. Product reads (viewing a product
page) are far more frequent than product writes (a price or stock update),
and a slightly stale price is rarely catastrophic — a textbook case for
caching. MongoDB is the source of truth; Redis sits in front of it as the
cache.

Each of the five strategies is implemented **independently**, against the
same `products` collection, using its own namespace of Redis keys
(`cache-aside:product:p1`, `write-back:product:p1`, ...). Each strategy is
demonstrated through exactly **one endpoint** that does exactly **one
thing**: the two read strategies are plain `GET`s (call one twice to see
MISS then HIT); the three write strategies are `POST`s that only insert a
new product — nothing else is chained after. Write-Back's row reaches
MongoDB purely through its own background job, on its own schedule; the
endpoint never forces it.

## 2. Setup

### Prerequisites

- Node.js 18+
- A MongoDB instance
- A Redis instance

The easiest way to get MongoDB and Redis locally is Docker. This uses
non-default host ports (**27018** for Mongo, **6380** for Redis) on purpose:

```bash
docker run -d --name cache-demo-mongo -p 27018:27017 mongo:7
docker run -d --name cache-demo-redis -p 6380:6379 redis:7
```

> **Why non-default ports?** If you already have MongoDB or Redis installed
> natively, running via WSL, or in another Docker container using the
> standard ports (27017 / 6379), `localhost:27017` / `localhost:6379` will
> silently resolve to *that* instance instead of this project's containers.
> The app will start up fine and connect successfully — just to the wrong
> database — so you'd see no data, or someone else's data, in Compass /
> `redis-cli` while wondering why the demo "isn't working." If you're sure
> nothing else is bound to the standard ports, feel free to use
> `-p 27017:27017` / `-p 6379:6379` and the matching defaults instead.

### Environment variables

Copy `.env.example` to `.env` and adjust if needed:

```bash
cp .env.example .env
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Express server port |
| `MONGO_URL` | `mongodb://localhost:27018` | MongoDB connection string |
| `MONGO_DB_NAME` | `cache_demo` | Database name |
| `REDIS_URL` | `redis://localhost:6380` | Redis connection string |
| `DB_LATENCY_MS` | `300` | Artificial delay added to every MongoDB read/write, so the benefit of caching is visible in response times |
| `WRITE_BACK_FLUSH_INTERVAL_MS` | `10000` | How often the Write-Back background job flushes dirty data to MongoDB |

### Run the application

```bash
npm install
npm start
```

On startup the app connects to MongoDB and Redis, seeds five sample products
(`p1`..`p5`) if the collection is empty, and starts listening on
`http://localhost:3000`. Watch this terminal during the demo — every
strategy prints what it's doing (`HIT`/`MISS`/`READ`/`WRITE`/`FLUSH`, etc).

## 3. API

All endpoints are under `/api`.

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | `/api/products` | List all products, straight from MongoDB (no caching) |
| POST | `/api/seed` | Reseed the product catalog |
| DELETE | `/api/cache` | Clear cache keys (see options below) |
| GET | `/api/cache-aside` | One read via **Cache-Aside**. `?id=` (default `p1`) |
| GET | `/api/read-through` | One read via **Read-Through**. `?id=` (default `p2`) |
| POST | `/api/write-through` | Create a product via **Write-Through** (MongoDB insert, Redis primed immediately) |
| POST | `/api/write-around` | Create a product via **Write-Around** (MongoDB insert only, Redis untouched) |
| POST | `/api/write-back` | Create a product via **Write-Back** (Redis only; MongoDB gets it on the next background flush) |
| GET | `/api/inspect/mongo/:id` | Raw MongoDB document for a product |
| GET | `/api/inspect/redis/:id` | Raw Redis entry for a product. Requires `?strategy=` (`cacheAside`, `readThrough`, `writeThrough`, `writeAround`, `writeBack`) |

**`GET /api/cache-aside` and `/api/read-through`** each do exactly one read
and report whether it was a `HIT` or `MISS` (checked by peeking at Redis
*before* reading — this endpoint doesn't mutate anything, that's what
`DELETE /api/cache` is for). Call it, clear the cache, call it again, and
compare:

```bash
curl http://localhost:3000/api/cache-aside          # MISS (or HIT, if p1 was cached from before)
curl -X DELETE "http://localhost:3000/api/cache?strategy=cacheAside&id=p1"
curl http://localhost:3000/api/cache-aside          # MISS, guaranteed
curl http://localhost:3000/api/cache-aside          # HIT
```

**`DELETE /api/cache`** takes optional query params:
- no params → wipes every demo cache key
- `?strategy=cacheAside` → wipes all keys for that strategy
- `?strategy=cacheAside&id=p1` → wipes just that one key

**The three write strategies** (`POST`) accept an optional JSON body:
`{ "id": "...", "name": "...", "category": "...", "price": ..., "stock": ... }`.
If `id` is omitted, a fresh one is generated so every call is a clean,
repeatable run against a brand new product.

### Example requests

```bash
# One read via cache-aside, reports HIT or MISS
curl http://localhost:3000/api/cache-aside

# Create a product via write-back -- Redis only, MongoDB catches up later
curl -X POST http://localhost:3000/api/write-back

# Same, but with an explicit product instead of the auto-generated default
curl -X POST http://localhost:3000/api/write-through \
  -H "Content-Type: application/json" \
  -d '{"id": "p20", "name": "Laptop Stand", "price": 29.99, "stock": 100}'

# Inspect what's actually sitting in Redis for write-back's copy of p5
curl "http://localhost:3000/api/inspect/redis/p5?strategy=writeBack"
```

## 4. The Five Caching Strategies

### Reading

#### Cache-Aside (a.k.a. Lazy Loading)

The **application** owns the caching logic: check the cache, and on a miss,
go read the database itself and populate the cache for next time.

**Flow in this project** (`src/strategies/cacheAside.js`, exercised by
`GET /api/cache-aside`):

```
GET /api/cache-aside?id=<id>
        |
        v
  getProduct(id)
        |
        v
  Redis GET cache-aside:product:<id>
        |
   hit? ----> return cached value
        |
       miss
        v
  MongoDB findOne({_id})
        |
        v
  Redis SET cache-aside:product:<id>  (TTL 60s)
        |
        v
      return value
```

Call `GET /api/cache-aside` — it reports whether that read was a `HIT` or a
`MISS` and how long it took (`tookMs`). Clear the cache first with
`DELETE /api/cache?strategy=cacheAside&id=p1` for a guaranteed MISS, then
call it again for a guaranteed HIT, and compare `tookMs` between the two.

- **Advantage:** simple, and only the data that's actually requested ends up in the cache.
- **Disadvantage:** every cache miss is a slow round trip, and there's a small window where the app could crash after the DB read but before populating the cache.
- **When to use:** general-purpose, read-heavy workloads where the app already has natural read/write code paths — the most common strategy in practice.

#### Read-Through

Conceptually identical goal to cache-aside, but the **cache/library** owns
the loading logic instead of the application. The application only ever
calls `cache.getProduct(id)` and never talks to MongoDB directly.

**Flow in this project** (`src/strategies/readThrough.js`, exercised by
`GET /api/read-through`):

```
GET /api/read-through?id=<id>
        |
        v
   app calls cache.getProduct(id)
        |
        v
  [inside the cache] Redis GET read-through:product:<id>
        |
   hit? ----> return cached value
        |
       miss
        v
  [inside the cache] loader() -> MongoDB findOne({_id})
        |
        v
  Redis SET read-through:product:<id>  (TTL 60s)
        |
        v
      return value
```

- **Advantage:** the application code is simpler and can't accidentally bypass the cache — the loading/populating logic lives in one place.
- **Disadvantage:** requires a caching layer/library that can load-on-miss for you; the first request for any item is still slow.
- **When to use:** when you have (or can adopt) a caching library/proxy that supports it, and you want to keep application code free of cache-population logic.

> **Implementation note:** in this demo, Cache-Aside and Read-Through produce
> the same Redis/MongoDB behavior — the teaching point is *who is
> responsible* for the miss-handling code (`readThrough()` in
> `src/strategies/readThrough.js` is a generic helper the "cache" would run
> internally, versus the route handler doing it explicitly in
> `cacheAside.js`). In a production system, Read-Through is usually provided
> by dedicated caching infrastructure (e.g. a caching proxy or an ORM
> plugin) rather than hand-written application code.

### Writing

#### Write-Through

Every write goes to MongoDB **and** Redis in the same request, before
responding. The cache is never allowed to go stale — and that includes brand
new rows, not just updates.

**Flow in this project** (`src/strategies/writeThrough.js`, exercised by
`POST /api/write-through`, which only creates a product):

```
POST /api/write-through
        |
        v
  MongoDB insertOne(...)
        |
        v
  Redis SET write-through:product:<id>  (TTL 60s) -- primed immediately
        |
        v
      respond to client
```

Because the cache is primed on create, the very first read for a
newly-created product is already a cache **HIT** — check it yourself right
after creating one: `GET /api/inspect/redis/<id>?strategy=writeThrough`
shows `exists: true` before you've ever read the product through the app.

- **Advantage:** cache and database are always consistent; reads are always fast and fresh, even for data created moments ago.
- **Disadvantage:** every write pays the full cost of a database write (see `DB_LATENCY_MS` in the logs) before it can return.
- **When to use:** when read-after-write consistency matters and write volume is manageable (e.g. user profile or catalog data that's read far more than it's written).

#### Write-Back / Write-Behind

The write only touches Redis and returns immediately. The new key is
recorded in a "dirty set"; a background job, running on its own timer, is
the *only* thing that ever drains that set and persists it to MongoDB.

**Flow in this project** (`src/strategies/writeBack.js`, exercised by
`POST /api/write-back`, which only creates a product):

```
POST /api/write-back
        |
        v
  Redis SET write-back:product:<id>   (fast, in-memory)
  Redis SADD write-back:dirty-ids <id>
        |
        v
      respond to client immediately        <- MongoDB has NOT been touched

        .
        .  (nothing happens here except waiting -- no code path forces this)
        .

[background timer -- fires on its own every WRITE_BACK_FLUSH_INTERVAL_MS]
        |
        v
  flushDirty():
    for each dirty id:
      MongoDB upsert({_id}, {$set: value})   <- upsert, since the row may
      Redis SREM write-back:dirty-ids <id>      never have existed in Mongo
```

This is where write-back's risk is most visible. Right after `POST
/api/write-back`, `GET /api/inspect/mongo/<id>` returns `404` — the row
plain doesn't exist yet — while `GET /api/inspect/redis/<id>?strategy=writeBack`
shows it fully populated. The product is completely readable through the
app, but a crash right then would lose it with no trace, since it never
touched the database. Wait up to `WRITE_BACK_FLUSH_INTERVAL_MS` (10s by
default) and check `/api/inspect/mongo/<id>` again — the background job
will have picked it up on its own, with nothing in the request path forcing
it.

- **Advantage:** writes are extremely fast, since they never wait on the database.
- **Disadvantage:** if Redis crashes or the process dies before a flush, unflushed writes are lost — MongoDB and Redis are temporarily inconsistent by design. For a newly-created row this is worse than losing an update: the product never existed in MongoDB at all, so it simply vanishes.
- **When to use:** write-heavy workloads that can tolerate a small durability/consistency window in exchange for write throughput (e.g. view counters, activity logs, inventory decrements under load).

#### Write-Around

Writes go **straight to MongoDB**, completely bypassing Redis. Any existing
cache entry is invalidated (deleted) instead of updated, so the next read is
a guaranteed miss that repopulates the cache from the database.

**Flow in this project** (`src/strategies/writeAround.js`, exercised by
`POST /api/write-around`, which only creates a product):

```
POST /api/write-around
        |
        v
  MongoDB insertOne(...)
        |
        v
      respond to client              <- Redis was never contacted
```

Create a product with `POST /api/write-around`, then check
`GET /api/inspect/redis/<id>?strategy=writeAround` — it comes back
`exists: false`, because the cache was never touched by the write. That's
the whole point of this endpoint: write-around's cache entries only ever
get created by a *read*, never by the write itself (the module still has
its own `getProduct`, in `src/strategies/writeAround.js`, that would
populate this same key cache-aside style — this demo just doesn't wire a
read endpoint to write-around's own namespace, so `/inspect` is how you
confirm the write left it untouched).

- **Advantage:** avoids filling the cache with data from writes that may never be read again (good when writes and reads target different data).
- **Disadvantage:** the first read after a write is always slow, since the cache was just invalidated rather than refreshed.
- **When to use:** write-heavy data that's rarely re-read right after being written — e.g. bulk price imports, admin bulk updates, analytics ingestion.

## 5. Comparison

| Strategy | Read/Write | Main Idea | Consistency | Main Benefit | Main Risk |
| --- | --- | --- | --- | --- | --- |
| Cache-Aside | Read | App checks cache, loads DB on miss, populates cache itself | Cache can be stale until TTL expires or is invalidated | Simple, only caches what's actually read | Every miss is slow; cache-population logic duplicated across the app |
| Read-Through | Read | Cache/library loads on miss on the app's behalf | Same as cache-aside | App code never touches the DB directly | Needs a caching layer that supports it |
| Write-Through | Write | Write hits DB and cache together, synchronously | Strong — cache always matches DB | Reads are always fresh | Writes are as slow as the DB itself |
| Write-Back / Write-Behind | Write | Write hits cache only; DB updated later by a background flush | Weak, temporary — DB lags cache until flush | Writes are very fast | Data loss risk if cache dies before flush |
| Write-Around | Write | Write hits DB only; cache entry invalidated, not updated | Cache is stale/absent until next read | Avoids caching rarely-read writes | First read after a write is always slow |

## 6. Demo

With the app running (`npm start`) and sample data seeded automatically,
either run the bundled script:

```bash
bash demo.sh
```

or drive it manually, one curl per strategy — ideally with the app's
console open in one terminal and a Redis/Mongo client in another:

```bash
docker exec -it cache-demo-redis redis-cli
docker exec -it cache-demo-mongo mongosh cache_demo
```

```bash
# 1. Cache-Aside: clear, then read twice -- MISS (~300ms) then HIT (~1ms) for p1
curl -X DELETE "http://localhost:3000/api/cache?strategy=cacheAside&id=p1"
curl http://localhost:3000/api/cache-aside
curl http://localhost:3000/api/cache-aside

# 2. Read-Through: same shape, different responsible party (see the code/logs)
curl -X DELETE "http://localhost:3000/api/cache?strategy=readThrough&id=p2"
curl http://localhost:3000/api/read-through
curl http://localhost:3000/api/read-through

# 3. Write-Through: create, then check Redis was already primed
curl -X POST http://localhost:3000/api/write-through
curl "http://localhost:3000/api/inspect/redis/<id>?strategy=writeThrough"   # exists: true

# 4. Write-Around: create, then check Redis was never touched
curl -X POST http://localhost:3000/api/write-around
curl "http://localhost:3000/api/inspect/redis/<id>?strategy=writeAround"   # exists: false

# 5. Write-Back: create, check MongoDB doesn't have it yet, then watch it
#    appear on its own once the background flush job ticks (no manual step)
curl -X POST http://localhost:3000/api/write-back
curl http://localhost:3000/api/inspect/mongo/<id>   # 404, right after create
# wait a few seconds (up to WRITE_BACK_FLUSH_INTERVAL_MS, 10s by default)...
curl http://localhost:3000/api/inspect/mongo/<id>   # 200, persisted by the background job
```

(Replace `<id>` with the `product._id` from the corresponding create
response.)

Each endpoint responds with a single, flat result — no extra Mongo/Redis
snapshots bundled in, since that's exactly what `/api/inspect/*` is for:

```json
{ "strategy": "cache-aside", "productId": "p1", "outcome": "MISS", "tookMs": 312, "product": { "...": "..." } }
```

```json
{ "strategy": "write-back", "tookMs": 3, "product": { "_id": "p9x8y7z", "...": "..." } }
```

Use `/api/inspect/mongo/:id` and `/api/inspect/redis/:id?strategy=`
afterwards to see what each store actually holds for a given id — that's
the one and only place state gets inspected.

Throughout, watch the `npm start` terminal — every strategy logs its own
`HIT` / `MISS` / `READ` / `WRITE` / `STORE` / `INVALIDATE` / `FLUSH` events,
so you can see exactly which system (Redis, MongoDB, or both) each request
touched.
