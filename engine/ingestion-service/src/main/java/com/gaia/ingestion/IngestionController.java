package com.gaia.ingestion;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.gaia.simulator.domain.WorldFactory;
import com.gaia.simulator.domain.event.SimEvent;
import com.gaia.simulator.engine.SimulationEngine;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
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
    /** Domains that emit events — used to pre-register per-domain severity gauges. */
    private static final List<String> DOMAINS = List.of("energy", "cities", "transport", "finance");

    private final KafkaTemplate<String, String> kafka;
    private final SimulationEngine engine;
    private final MeterRegistry meters;
    private final AtomicLong published = new AtomicLong();
    private final Deque<String> recentJson = new ArrayDeque<>(BUFFER_MAX);
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final Map<String, AtomicReference<Double>> maxSeverityByDomain = new ConcurrentHashMap<>();

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
    private static final Instant START = Instant.parse("2026-09-15T00:00:00Z");

    private final long entityBudget;

    private SimulationEngine newEngine() {
        return new SimulationEngine(
                WorldFactory.entitiesWorld(entityBudget), SEED, 50L, START);
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
     * fresh clone and returns events in [fromTick, toTick] without publishing.
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
                for (SimEvent e : events) {
                    out.add(objectMapper.readTree(serialize(e)));
                }
            }
        }
        return out;
    }

    private void publish(List<SimEvent> events) {
        for (SimEvent e : events) {
            String json = serialize(e);
            kafka.send(TOPIC_EVENTS, e.domain().label(), json);
            synchronized (recentJson) {
                recentJson.addFirst(json);
                if (recentJson.size() > BUFFER_MAX) recentJson.removeLast();
            }
            published.incrementAndGet();

            String domain = e.domain().label();
            meters.counter("gaia_sim_events_published").increment();
            meters.counter("gaia_sim_events_by_domain", "domain", domain).increment();
            maxSeverityByDomain.computeIfAbsent(domain, key -> new AtomicReference<>(0.0))
                    .updateAndGet(previous -> Math.max(previous, e.severity()));
        }
    }

    private String serialize(SimEvent e) {
        return String.format(Locale.ROOT,
                "{\"id\":\"%s\",\"tick\":%d,\"ts\":\"%s\",\"domain\":\"%s\",\"type\":\"%s\",\"region\":\"%s\",\"severity\":%.3f,\"payload\":%s}",
                e.id(), e.tick(), e.ts(), e.domain().label(), e.type(),
                e.region(), e.severity(), e.payloadJson());
    }
}