package com.gaia.streaming;

import org.apache.flink.api.common.eventtime.WatermarkStrategy;
import org.apache.flink.api.common.functions.MapFunction;
import org.apache.flink.api.common.serialization.SimpleStringSchema;
import org.apache.flink.api.connector.sink2.Sink;
import org.apache.flink.connector.jdbc.JdbcConnectionOptions;
import org.apache.flink.connector.jdbc.JdbcExecutionOptions;
import org.apache.flink.connector.jdbc.core.datastream.sink.JdbcSink;
import org.apache.flink.connector.kafka.sink.KafkaRecordSerializationSchema;
import org.apache.flink.connector.kafka.sink.KafkaSink;
import org.apache.flink.connector.kafka.source.KafkaSource;
import org.apache.flink.connector.kafka.source.enumerator.initializer.OffsetsInitializer;
import org.apache.flink.streaming.api.datastream.DataStream;
import org.apache.flink.streaming.api.environment.StreamExecutionEnvironment;
import org.apache.flink.streaming.api.functions.windowing.WindowFunction;
import org.apache.flink.streaming.api.windowing.assigners.SlidingEventTimeWindows;
import org.apache.flink.streaming.api.windowing.time.Time;
import org.apache.flink.streaming.api.windowing.windows.TimeWindow;
import org.apache.flink.util.Collector;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Arrays;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Consumes {@code gaia.sim.events}, computes sliding-window aggregates per
 * domain and per region, then:
 *
 * <ul>
 *   <li>pushes the per-domain windows to Kafka ({@code gaia.sim.aggregates});</li>
 *   <li>writes both window sets to PostGIS ({@code gaia_domain_aggregates},
 *       {@code gaia_region_aggregates}) so they can be queried spatially against
 *       {@code gaia_regions}.</li>
 * </ul>
 *
 * <p>Window sizes come from env ({@code GAIA_WINDOW_MS} / {@code GAIA_SLIDE_MS},
 * defaults 5 min / 1 min) so demos can shrink them without editing production.
 */
public final class AggregatorJob {

    /** Topic consumed by the dashboards / exports. */
    private static final String TOPIC_AGGREGATES = "gaia.sim.aggregates";

    private static final String POSTGRES_DOMAIN_UPSERT =
            "INSERT INTO gaia_domain_aggregates "
                    + "(domain, window_start, window_end, event_count, max_severity, avg_severity) "
                    + "VALUES (?, ?, ?, ?, ?, ?) "
                    + "ON CONFLICT (domain, window_start, window_end) DO UPDATE SET "
                    + "event_count = EXCLUDED.event_count, "
                    + "max_severity = EXCLUDED.max_severity, "
                    + "avg_severity = EXCLUDED.avg_severity";

    private static final String POSTGRES_REGION_UPSERT =
            "INSERT INTO gaia_region_aggregates "
                    + "(region, window_start, window_end, event_count, max_severity, avg_severity) "
                    + "VALUES (?, ?, ?, ?, ?, ?) "
                    + "ON CONFLICT (region, window_start, window_end) DO UPDATE SET "
                    + "event_count = EXCLUDED.event_count, "
                    + "max_severity = EXCLUDED.max_severity, "
                    + "avg_severity = EXCLUDED.avg_severity";

    public static void main(String[] args) throws Exception {
        String brokers = System.getenv().getOrDefault("KAFKA_BROKERS", "localhost:9093");
        long windowMs = Long.parseLong(System.getenv().getOrDefault("GAIA_WINDOW_MS", "300000"));
        long slideMs = Long.parseLong(System.getenv().getOrDefault("GAIA_SLIDE_MS", "60000"));
        String jdbcUrl = System.getenv().getOrDefault("POSTGRES_JDBC",
                "jdbc:postgresql://localhost:55432/gaia");
        String jdbcUser = System.getenv().getOrDefault("POSTGRES_USER", "gaia");
        String jdbcPassword = System.getenv().getOrDefault("POSTGRES_PASSWORD", "gaia_dev");

        StreamExecutionEnvironment env = StreamExecutionEnvironment.getExecutionEnvironment();
        env.getConfig().setAutoWatermarkInterval(500L);

        Properties props = new Properties();
        props.setProperty("bootstrap.servers", brokers);
        props.setProperty("group.id", "gaia-aggregator");

        KafkaSource<String> source = KafkaSource.<String>builder()
                .setBootstrapServers(brokers)
                .setTopics("gaia.sim.events")
                .setGroupId("gaia-aggregator")
                .setStartingOffsets(OffsetsInitializer.earliest())
                .setValueOnlyDeserializer(new SimpleStringSchema())
                .setProperties(props)
                .build();

        DataStream<String> raw = env.fromSource(
                source, WatermarkStrategy.noWatermarks(), "gaia-events-source");

        DataStream<SimEvent> events = raw
                .map((MapFunction<String, SimEvent>) SimEvent::fromJson)
                // one malformed record must never take the whole job down
                .filter((SimEvent e) -> e != null)
                .assignTimestampsAndWatermarks(WatermarkStrategy
                        .<SimEvent>forBoundedOutOfOrderness(Duration.ofMillis(slideMs))
                        // real event time from the payload `ts` (falls back to tick seconds)
                        .withTimestampAssigner((e, ts) -> e.eventTimeMillis()));

        SlidingEventTimeWindows windows = SlidingEventTimeWindows.of(
                Time.milliseconds(windowMs), Time.milliseconds(slideMs));

        // 1. per-domain sliding windows (also written to PostGIS below)
        DataStream<Aggregate> byDomain = events
                .keyBy(SimEvent::domain)
                .window(windows)
                .apply(new Aggregator());

        // 2. domain windows → Kafka gaia.sim.aggregates (documented payload shape)
        KafkaSink<String> kafkaSink = KafkaSink.<String>builder()
                .setBootstrapServers(brokers)
                .setRecordSerializer(KafkaRecordSerializationSchema.builder()
                        .setTopic(TOPIC_AGGREGATES)
                        .setValueSerializationSchema(new SimpleStringSchema())
                        .build())
                .setKafkaProducerConfig(props)
                .build();
        byDomain.map(new AggregateJson()).sinkTo(kafkaSink);

        // 3. domain windows → PostGIS
        byDomain.sinkTo(postgresSink(jdbcUrl, jdbcUser, jdbcPassword, POSTGRES_DOMAIN_UPSERT));

        // 4. per-region sliding windows → PostGIS (joined to gaia_regions for geo queries)
        events.keyBy(SimEvent::region)
                .window(windows)
                .apply(new Aggregator())
                .sinkTo(postgresSink(jdbcUrl, jdbcUser, jdbcPassword, POSTGRES_REGION_UPSERT));

        env.execute("gaia-streaming-aggregator");
    }

    /** At-least-once JDBC sink writing {@link Aggregate} rows into PostGIS. */
    private static Sink<Aggregate> postgresSink(String url, String user, String password,
                                                String sql) {
        return JdbcSink.<Aggregate>builder()
                .withQueryStatement(sql, (ps, a) -> {
                    ps.setString(1, a.key());
                    ps.setTimestamp(2, Timestamp.from(Instant.ofEpochMilli(a.windowStart())));
                    ps.setTimestamp(3, Timestamp.from(Instant.ofEpochMilli(a.windowEnd())));
                    ps.setLong(4, a.count());
                    ps.setDouble(5, a.maxSeverity());
                    ps.setDouble(6, a.avgSeverity());
                })
                .withExecutionOptions(JdbcExecutionOptions.builder()
                        .withBatchSize(50)
                        .withBatchIntervalMs(1000L)
                        .withMaxRetries(3)
                        .build())
                .buildAtLeastOnce(new JdbcConnectionOptions.JdbcConnectionOptionsBuilder()
                        .withUrl(url)
                        .withDriverName("org.postgresql.Driver")
                        .withUsername(user)
                        .withPassword(password)
                        .build());
    }

    /**
     * Minimal JSON model in the streaming job (no Jackson required).
     *
     * <p>The parser is intentionally forgiving: it accepts both compact payloads
     * ({@code "domain":"energy"}) and spaced ones ({@code "domain": "energy"}),
     * which keeps window keys clean no matter which producer wrote the record,
     * and it drops malformed records instead of failing the job.
     */
    public record SimEvent(String id, Integer tick, Instant ts, String domain, String type,
                           String region, Double severity) {

        /** Region used for world-scope events (see docs/SIMULATION_MODEL.md). */
        private static final String DEFAULT_REGION = "global";

        private static final Map<String, Pattern> FIELD_PATTERNS =
                Arrays.stream(new String[]{"id", "tick", "ts", "domain", "type", "region", "severity"})
                        .collect(Collectors.toUnmodifiableMap(key -> key, key -> Pattern.compile(
                                "\"" + key + "\"\\s*:\\s*(?:\"([^\"]*)\"|([^,}\\s]+))")));

        /**
         * Event time used for windowing: the payload {@code ts} when present and
         * valid, otherwise the tick number interpreted as seconds since epoch
         * (hand-made demo payloads only — every real event carries {@code ts}).
         */
        public long eventTimeMillis() {
            return ts != null ? ts.toEpochMilli() : tick * 1000L;
        }

        /** Parses one Kafka record; {@code null} means "skip this record". */
        static SimEvent fromJson(String line) {
            if (line == null || !line.contains("\"tick\"") || !line.contains("\"domain\"")) {
                return null;
            }
            String domain = field(line, "domain").trim();
            if (domain.isEmpty()) {
                return null;
            }
            String region = field(line, "region").trim();
            return new SimEvent(field(line, "id"), (int) number(line, "tick", 0),
                    instant(line, "ts"), domain, field(line, "type"),
                    region.isEmpty() ? DEFAULT_REGION : region, number(line, "severity", 0));
        }

        /** ISO-8601 value of {@code key}, or {@code null} when absent/unparseable. */
        static Instant instant(String json, String key) {
            String raw = field(json, key);
            if (raw.isEmpty()) {
                return null;
            }
            try {
                return Instant.parse(raw);
            } catch (DateTimeParseException malformedTimestamp) {
                return null;
            }
        }

        /** Raw string value of {@code key}, or {@code ""} when absent. */
        static String field(String json, String key) {
            Pattern pattern = FIELD_PATTERNS.get(key);
            if (pattern == null) {
                return "";
            }
            Matcher matcher = pattern.matcher(json);
            if (!matcher.find()) {
                return "";
            }
            String quoted = matcher.group(1);
            return quoted != null ? quoted : matcher.group(2).trim();
        }

        /** Numeric value of {@code key}, falling back when absent/not a number. */
        static double number(String json, String key, double fallback) {
            String raw = field(json, key);
            if (raw.isEmpty()) {
                return fallback;
            }
            try {
                return Double.parseDouble(raw);
            } catch (NumberFormatException notANumber) {
                return fallback;
            }
        }
    }

    /** Windowed aggregate over an arbitrary key: a domain or a region. */
    public record Aggregate(String key, long windowStart, long windowEnd, long count,
                            double maxSeverity, double avgSeverity) {
    }

    private static class Aggregator implements WindowFunction<SimEvent, Aggregate,
            String, TimeWindow> {
        @Override
        public void apply(String key, TimeWindow window, Iterable<SimEvent> in,
                          Collector<Aggregate> out) {
            long count = 0;
            double max = 0, sum = 0;
            for (SimEvent e : in) {
                count++;
                max = Math.max(max, e.severity());
                sum += e.severity();
            }
            out.collect(new Aggregate(key, window.getStart(), window.getEnd(),
                    count, max, count == 0 ? 0 : sum / count));
        }
    }

    /** Serializes domain aggregates to the documented Kafka payload shape. */
    private static class AggregateJson implements MapFunction<Aggregate, String> {
        @Override
        public String map(Aggregate a) {
            return String.format(Locale.ROOT, "{\"domain\":\"%s\",\"windowStart\":%d,\"windowEnd\":%d,\"count\":%d,\"maxSeverity\":%.3f,\"avgSeverity\":%.3f}",
                    a.key(), a.windowStart(), a.windowEnd(), a.count(),
                    a.maxSeverity(), a.avgSeverity());
        }
    }
}