package com.gaia.simulator;

import com.gaia.simulator.domain.WorldFactory;
import com.gaia.simulator.domain.event.SimEvent;
import com.gaia.simulator.engine.SimulationEngine;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class SimulationEngineTest {

    private static SimulationEngine engine(long seed) {
        return new SimulationEngine(WorldFactory.defaultWorld(3, 4, 3, 4, 3),
                seed, 50L, Instant.parse("2026-09-15T00:00:00Z"));
    }

    /** Determinism is the core contract: same seed ⇒ same event stream (sans IDs aléatoires). */
    @Test
    void sameSeedProducesIdenticalEventStream() {
        List<SimEvent> a = engine(42L).run(500);
        List<SimEvent> b = engine(42L).run(500);

        assertThat(count(a)).isEqualTo(count(b));
        assertThat(count(a).stream().toList()).isEqualTo(count(b).stream().toList());
    }

    /** Different seed ⇒ the stream diverges. */
    @Test
    void differentSeedDiverges() {
        List<SimEvent> a = engine(1L).run(300);
        List<SimEvent> b = engine(2L).run(300);

        assertThat(count(a).stream().toList())
                .as("different seeds must diverge")
                .isNotEqualTo(count(b).stream().toList());
    }

    @Test
    void everyTickEmitsAcrossAllDomains() {
        List<SimEvent> events = engine(7L).run(100);
        var domains = events.stream().map(e -> e.domain().name()).distinct().toList();

        assertThat(domains).containsExactlyInAnyOrder("ENERGY", "CITIES", "TRANSPORT", "FINANCE");
    }

    @Test
    void tickClockAdvancesWithFixedStep() {
        SimulationEngine e = engine(5L);
        e.run(2);
        assertThat(e.tickIndex()).isEqualTo(2);
    }

    /** Event identity: comparison ignores the random UUID but keeps all sim-relevant fields. */
    private static List<String> count(List<SimEvent> events) {
        return events.stream()
                .map(e -> "%d|%s|%s|%s|%s|%.4f".formatted(e.tick(), e.ts(), e.domain(),
                        e.type(), e.region(), e.severity()))
                .toList();
    }
}