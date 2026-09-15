package com.gaia.ingestion;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.gaia.simulator.domain.WorldFactory;
import com.gaia.simulator.domain.event.SimEvent;
import com.gaia.simulator.engine.SimulationEngine;
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
import java.util.concurrent.atomic.AtomicLong;

/**
 * Drives the deterministic simulation clock and publishes events to Kafka.
 * Also exposes a manual "/ticks" endpoint for demos and replay control.
 */
@RestController
public class IngestionController {

    public static final String TOPIC_EVENTS = "gaia.sim.events";
    private static final int BUFFER_MAX = 200;

    private final KafkaTemplate<String, String> kafka;
    private final SimulationEngine engine;
    private final AtomicLong published = new AtomicLong();
    private final Deque<String> recentJson = new ArrayDeque<>(BUFFER_MAX);
    private final ObjectMapper objectMapper = new ObjectMapper();

    public IngestionController(KafkaTemplate<String, String> kafka) {
        this.kafka = kafka;
        this.engine = new SimulationEngine(
                WorldFactory.defaultWorld(3, 4, 3, 4, 3),
                42L, 50L, Instant.parse("2026-09-15T00:00:00Z"));
    }

    @Scheduled(fixedDelayString = "${gaia.tick.period-ms:1000}")
    public void tickLoop() {
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

    private void publish(List<SimEvent> events) {
        for (SimEvent e : events) {
            String json = serialize(e);
            kafka.send(TOPIC_EVENTS, e.domain().label(), json);
            synchronized (recentJson) {
                recentJson.addFirst(json);
                if (recentJson.size() > BUFFER_MAX) recentJson.removeLast();
            }
            published.incrementAndGet();
        }
    }

    private String serialize(SimEvent e) {
        return String.format(Locale.ROOT,
                "{\"id\":\"%s\",\"tick\":%d,\"ts\":\"%s\",\"domain\":\"%s\",\"type\":\"%s\",\"region\":\"%s\",\"severity\":%.3f,\"payload\":%s}",
                e.id(), e.tick(), e.ts(), e.domain().label(), e.type(),
                e.region(), e.severity(), e.payloadJson());
    }
}