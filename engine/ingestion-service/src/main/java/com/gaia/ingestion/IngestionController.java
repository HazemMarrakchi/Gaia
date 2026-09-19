package com.gaia.ingestion;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.gaia.simulator.domain.WorldFactory;
import com.gaia.simulator.domain.event.SimEvent;
import com.gaia.simulator.engine.SimulationEngine;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Drives the deterministic simulation clock and publishes events to Kafka.
 * Also exposes a manual "/ticks" endpoint for demos and replay control.
 */
@RestController
public class IngestionController {

    public static final String TOPIC_EVENTS = "gaia.sim.events";
    private static final int BUFFER_MAX = 200;
    /** How long to stop trying Kafka after a failed publish (self-healing breaker). */
    private static final long KAFKA_RETRY_MS = 15_000L;
    /** Domains that emit events — used to pre-register per-domain severity gauges. */
    private static final List<String> DOMAINS = List.of("energy", "cities", "transport", "finance");

    private static final Logger log = LoggerFactory.getLogger(IngestionController.class);

    private final KafkaTemplate<String, String> kafka;
    private final SimulationEngine engine;
    private final MeterRegistry meters;
    private final AtomicLong published = new AtomicLong();
    private final Deque<String> recentJson = new ArrayDeque<>(BUFFER_MAX);
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final Map<String, AtomicReference<Double>> maxSeverityByDomain = new ConcurrentHashMap<>();
    /** Epoch-ms until which publishes are skipped (Kafka outage breaker). */
    private volatile long kafkaRetryAfter = 0L;

    public IngestionController(KafkaTemplate<String, String> kafka, MeterRegistry meters) {
        this.kafka = kafka;
        this.meters = meters;
        this.entityBudget = Long.parseLong(System.getenv().getOrDefault("SIM_MAX_ENTITIES", "1000000"));
        this.engine = newEngine();
        registerMetrics();
    }

    /** Tick index + per-domain severity, exported via /actuator/prometheus for Grafana. */
    private void registerMetrics() {
        Gauge.builder("gaia_sim_tick_index", engine, SimulationEngine::tickIndex).register(meters);
        for (String domain : DOMAINS) {
            AtomicReference<Double> max = new AtomicReference<>(0.0);
            maxSeverityByDomain.put(domain, max);
            Gauge.builder("gaia_sim_max_severity", max, AtomicReference::get)
                    .tag("domain", domain)
                    .register(meters);
        }
    }

    private static final long SEED = 42L;
    /**
     * Sim-clock epoch: "now" floored to a 50 ms tick slot. Engine restarts
     * therefore resume the clock instead of resetting it to midnight — with a
     * reset, Flink watermarks (already ahead in event time) would drop every
     * new event as late and the live pipeline would silently go dark.
     */
    private static final long STEP_MS = 50L;
    private static final Instant START = Instant.ofEpochMilli(System.currentTimeMillis() / STEP_MS * STEP_MS);

    private final long entityBudget;

    private SimulationEngine newEngine() {
        return new SimulationEngine(
                WorldFactory.entitiesWorld(entityBudget), SEED, STEP_MS, START);
    }

    @Scheduled(fixedDelayString = "${gaia.tick.period-ms:1000}")
    public void tickLoop() {
        meters.counter("gaia_sim_ticks").increment();
        publish(engine.step());
    }

    @PostMapping("/ticks")
    public List<String> manualTicks(@RequestParam(defaultValue = "1") int n) {
        List<SimEvent> events = engine.run(n);
        publish(events);
        return events.stream().map(SimEvent::id).toList();
    }

    @GetMapping("/health/sim")
    public String simHealth() {
        return "tick=%d published=%d".formatted(engine.tickIndex(), published.get());
    }

    @GetMapping("/events")
    public List<JsonNode> recentEvents(@RequestParam(defaultValue = "50") int limit) throws Exception {
        synchronized (recentJson) {
            List<JsonNode> out = new java.util.ArrayList<>();
            for (String json : recentJson) {
                out.add(objectMapper.readTree(json));
                if (out.size() >= Math.min(limit, BUFFER_MAX)) break;
            }
            return out;
        }
    }

    /**
     * Deterministic replay: same seed + same config ⇒ identical events. Runs a
     * fresh clone and returns events in [fromTick, toTick] (each annotated with
     * the domain-state snapshot at that tick) without publishing.
     */
    @GetMapping("/replay")
    public List<JsonNode> replay(@RequestParam(defaultValue = "0") long fromTick,
                                 @RequestParam(defaultValue = "100") long toTick) throws Exception {
        if (toTick < fromTick || (toTick - fromTick) > 10_000) {
            throw new IllegalArgumentException("replay window must be <= 10_000 ticks");
        }
        SimulationEngine clone = newEngine();
        List<JsonNode> out = new java.util.ArrayList<>();
        for (long i = 0; i <= toTick && out.size() < 5_000; i++) {
            List<SimEvent> events = clone.step();
            if (i >= fromTick) {
                Map<String, Map<String, Object>> state = clone.state().snapshot();
                for (SimEvent e : events) {
                    JsonNode node = objectMapper.readTree(serialize(e));
                    ((com.fasterxml.jackson.databind.node.ObjectNode) node)
                            .set("state", objectMapper.valueToTree(compactState(state)));
                    out.add(node);
                }
            }
        }
        return out;
    }

    /**
     * Publishes to Kafka without ever stalling the simulation: if the broker is
     * unreachable the send would block for {@code max.block.ms} per event (60 s by
     * default), which freezes the tick loop and the HTTP API. Instead we open a
     * breaker for {@link #KAFKA_RETRY_MS}, drop fast, keep simulating, and retry
     * automatically once the broker is back.
     */
    private void send(SimEvent e, String json) {
        long now = System.currentTimeMillis();
        if (now < kafkaRetryAfter) {
            meters.counter("gaia_sim_events_dropped").increment();
            return;
        }
        try {
            kafka.send(TOPIC_EVENTS, e.domain().label(), json);
            meters.counter("gaia_sim_events_published").increment();
        } catch (Exception ex) {
            kafkaRetryAfter = now + KAFKA_RETRY_MS;
            meters.counter("gaia_sim_events_dropped").increment();
            log.warn("Kafka publish failed ({}); pausing publishes for {} ms — simulation and HTTP API keep running",
                    ex.getMessage(), KAFKA_RETRY_MS);
        }
    }

    private void publish(List<SimEvent> events) {
        for (SimEvent e : events) {
            String json = serialize(e);
            send(e, json);
            synchronized (recentJson) {
                recentJson.addFirst(json);
                if (recentJson.size() > BUFFER_MAX) recentJson.removeLast();
            }
            published.incrementAndGet();

            String domain = e.domain().label();
            meters.counter("gaia_sim_events_by_domain", "domain", domain).increment();
            maxSeverityByDomain.computeIfAbsent(domain, key -> new AtomicReference<>(0.0))
                    .updateAndGet(previous -> Math.max(previous, e.severity()));
        }
    }

    /**
     * Replay snapshot payload: scalars only. Entity collections are replaced by
     * their size (`districtsCount`, `vehiclesCount`, ...) so the payload stays a
     * few hundred bytes no matter whether the world holds 5k or 1M entities —
     * attaching the raw lists per event would be hundreds of MB at 1M scale.
     */
    private static Map<String, Object> compactState(Map<String, Map<String, Object>> snapshot) {
        Map<String, Object> out = new java.util.LinkedHashMap<>();
        snapshot.forEach((domain, values) -> {
            Map<String, Object> metrics = new java.util.LinkedHashMap<>();
            values.forEach((key, value) -> {
                if (value instanceof Number || value instanceof Boolean || value instanceof String) {
                    metrics.put(key, value);
                } else if (value instanceof java.util.Collection<?> collection) {
                    metrics.put(key + "Count", collection.size());
                } else if (value instanceof Map<?, ?> map) {
                    metrics.put(key + "Size", map.size());
                }
            });
            out.put(domain, metrics);
        });
        return out;
    }

    private String serialize(SimEvent e) {
        return String.format(Locale.ROOT,
                "{\"id\":\"%s\",\"tick\":%d,\"ts\":\"%s\",\"domain\":\"%s\",\"type\":\"%s\",\"region\":\"%s\",\"severity\":%.3f,\"payload\":%s}",
                e.id(), e.tick(), e.ts(), e.domain().label(), e.type(),
                e.region(), e.severity(), e.payloadJson());
    }
}