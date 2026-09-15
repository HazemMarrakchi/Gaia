package com.gaia.ingestion;

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
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Drives the deterministic simulation clock and publishes events to Kafka.
 * Also exposes a manual "/ticks" endpoint for demos and replay control.
 */
@RestController
public class IngestionController {

    public static final String TOPIC_EVENTS = "gaia.sim.events";

    private final KafkaTemplate<String, String> kafka;
    private final SimulationEngine engine;
    private final AtomicLong published = new AtomicLong();

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

    private void publish(List<SimEvent> events) {
        for (SimEvent e : events) {
            kafka.send(TOPIC_EVENTS, e.domain().label(), serialize(e));
            published.incrementAndGet();
        }
    }

    private String serialize(SimEvent e) {
        return "{\"id\":\"%s\",\"tick\":%d,\"ts\":\"%s\",\"domain\":\"%s\",\"type\":\"%s\","
                + "\"region\":\"%s\",\"severity\":%.3f,\"payload\":\"%s\"}"
                .formatted(e.id(), e.tick(), e.ts(), e.domain().label(), e.type(),
                        e.region(), e.severity(), e.payloadJson());
    }
}