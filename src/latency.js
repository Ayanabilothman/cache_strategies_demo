// MongoDB is fast on localhost, which would make caching feel pointless in a
// demo. This adds an artificial delay to every DB read/write so the cost of
// hitting the database (and the benefit of avoiding it) is easy to observe.
const DB_LATENCY_MS = Number(process.env.DB_LATENCY_MS || 300);

function simulateDbLatency() {
  return new Promise((resolve) => setTimeout(resolve, DB_LATENCY_MS));
}

module.exports = { simulateDbLatency, DB_LATENCY_MS };
