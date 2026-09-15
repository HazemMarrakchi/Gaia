package com.gaia.streaming;

import org.apache.flink.api.common.eventtime.WatermarkStrategy;
import org.apache.flink.api.common.functions.MapFunction;
import org.apache.flink.api.common.serialization.SimpleStringSchema;
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

import java.time.Duration;
import java.util.Locale;
import java.util.Properties;

/**
 * Consumes {@code gaia.sim.events}, computes sliding-window aggregates per
 * domain and pushes cross-domain severity snapshots to {@code gaia.sim.aggregates}.
 *
 * <p>Window sizes come from env ({@code GAIA_WINDOW_MS} / {@code GAIA_SLIDE_MS},
 * defaults 5 min / 1 min) so demos can shrink them without editing production.
 */
public final class AggregatorJob {

    public static void main(String[] args) throws Exception {
        String brokers = System.getenv().getOrDefault("KAFKA_BROKERS", "localhost:9093");
        long windowMs = Long.parseLong(System.getenv().getOrDefault("GAIA_WINDOW_MS", "300000"));
        long slideMs = Long.parseLong(System.getenv().getOrDefault("GAIA_SLIDE_MS", "60000"));

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
                .assignTimestampsAndWatermarks(WatermarkStrategy
                        .<SimEvent>forBoundedOutOfOrderness(Duration.ofMillis(slideMs))
                        .withTimestampAssigner((e, ts) -> e.tick() * 1000L));

        DataStream<Aggregate> aggregates = events
                .keyBy(SimEvent::domain)
                .window(SlidingEventTimeWindows.of(Time.milliseconds(windowMs), Time.milliseconds(slideMs)))
                .apply(new Aggregator());

        KafkaSink<String> sink = KafkaSink.<String>builder()
                .setBootstrapServers(brokers)
                .setRecordSerializer(KafkaRecordSerializationSchema.builder()
                        .setTopic("gaia.sim.aggregates")
                        .setValueSerializationSchema(new SimpleStringSchema())
                        .build())
                .setKafkaProducerConfig(props)
                .build();

        aggregates.map(new AggregateSinkJson()).sinkTo(sink);

        env.execute("gaia-streaming-aggregator");
    }

    /** Minimal JSON model in the streaming job (no Jackson required). */
    public record SimEvent(String id, Integer tick, String domain, String type,
                           String region, Double severity) {
        static SimEvent fromJson(String line) {
            String domain = field(line, "domain");
            String type = field(line, "type");
            String region = field(line, "region");
            int tick = (int) Double.parseDouble(field(line, "tick"));
            double sev = Double.parseDouble(field(line, "severity"));
            return new SimEvent(field(line, "id"), tick, domain, type, region, sev);
        }

        private static String field(String json, String key) {
            String marker = "\"" + key + "\":\"";
            int start = json.indexOf(marker);
            if (start >= 0) {
                int end = json.indexOf('"', start + marker.length());
                return json.substring(start + marker.length(), end);
            }
            marker = "\"" + key + "\":";
            start = json.indexOf(marker);
            if (start < 0) return "0";
            int end = json.indexOf(',', start);
            if (end < 0) end = json.indexOf('}', start);
            return json.substring(start + marker.length(), end).replace("\"", "");
        }
    }

    public record Aggregate(String domain, long windowStart, long windowEnd, long count,
                            double maxSeverity, double avgSeverity) {
    }

    private static class Aggregator implements WindowFunction<SimEvent, Aggregate,
            String, TimeWindow> {
        @Override
        public void apply(String domain, TimeWindow window, Iterable<SimEvent> in,
                          Collector<Aggregate> out) {
            long count = 0;
            double max = 0, sum = 0;
            for (SimEvent e : in) {
                count++;
                max = Math.max(max, e.severity());
                sum += e.severity();
            }
            out.collect(new Aggregate(domain, window.getStart(), window.getEnd(),
                    count, max, count == 0 ? 0 : sum / count));
        }
    }

    private static class AggregateSinkJson implements MapFunction<Aggregate, String> {
        @Override
        public String map(Aggregate a) {
            return String.format(Locale.ROOT, "{\"domain\":\"%s\",\"windowStart\":%d,\"windowEnd\":%d,\"count\":%d,\"maxSeverity\":%.3f,\"avgSeverity\":%.3f}",
                    a.domain(), a.windowStart(), a.windowEnd(), a.count(),
                    a.maxSeverity(), a.avgSeverity());
        }
    }
}