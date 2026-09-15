package com.gaia.simulator;

import com.gaia.simulator.domain.WorldFactory;
import com.gaia.simulator.domain.event.SimEvent;
import com.gaia.simulator.engine.SimulationEngine;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Map;

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
    void stressedWorldEmitsAcrossAllDomains() {
        SimulationEngine e = new SimulationEngine(WorldFactory.defaultWorld(3, 4, 3, 4, 3),
                7L, 50L, Instant.parse("2026-09-15T00:00:00Z"));
        e.state().module("energy").applyPerturbation("GLOBAL_HEATWAVE", Map.of());
        e.state().module("cities").applyPerturbation("STRAIN", Map.of());
        e.state().module("transport").applyPerturbation("FUEL_SPIKE", Map.of());
        e.state().module("finance").applyPerturbation("SHOCK", Map.of());

        List<SimEvent> events = e.run(100);
        var domains = events.stream().map(x -> x.domain().name()).distinct().toList();

        assertThat(domains).as("a stressed world must emit on all four domains")
                .containsExactlyInAnyOrder("ENERGY", "CITIES", "TRANSPORT", "FINANCE");
    }

    /**
     * Regional cascade: a heatwave pinned to one region must light up THAT
     * region only — the engine reports hot-spots with real region keys, which
     * is what the World Brain globe visualizes.
     */
    @Test
    void regionalHeatwaveEmitsRegionalHotSpots() {
        SimulationEngine e = new SimulationEngine(WorldFactory.defaultWorld(40, 30, 24, 80, 16),
                42L, 50L, Instant.parse("2026-09-15T00:00:00Z"));
        e.state().module("energy").applyPerturbation("HEATWAVE_EU_JULY", Map.of());

        List<SimEvent> events = e.run(120);
        var euWestStress = events.stream()
                .filter(ev -> "GRID_STRESS".equals(ev.type()))
                .filter(ev -> "eu-west".equals(ev.region()))
                .toList();

        assertThat(euWestStress).as("a heatwave in eu-west must emit eu-west hot-spots")
                .isNotEmpty();
    }

    @Test
    void tickClockAdvancesWithFixedStep() {
        SimulationEngine e = engine(5L);
        e.run(2);
        assertThat(e.tickIndex()).isEqualTo(2);
    }

    /** Cross-domain coupling is real: a heatwave must mechanically stress finance. */
    @Test
    void heatwaveCrisisPropagatesIntoFinance() {
        SimulationEngine baseline = new SimulationEngine(WorldFactory.defaultWorld(25, 20, 18, 60, 12),
                42L, 50L, Instant.parse("2026-09-15T00:00:00Z"));

        SimulationEngine crisis = new SimulationEngine(WorldFactory.defaultWorld(25, 20, 18, 60, 12),
                42L, 50L, Instant.parse("2026-09-15T00:00:00Z"));

double baselineIdx = 0, crisisIdx = 0;
        double baselineShock = 0, crisisShock = 0;
        for (long i = 0; i < 120; i++) {
            crisis.state().module("energy").applyPerturbation("HEATWAVE", Map.of());
            baseline.step();
            crisis.step();
            baselineIdx = idx(baseline);
            crisisIdx = idx(crisis);
            baselineShock = baseline.externalShock();
            crisisShock = crisis.externalShock();
        }

        assertThat(crisisShock).as("a heatwave must raise the engine's crisis EMA")
                .isGreaterThan(baselineShock);
        assertThat(crisisIdx).as("a heatwave must mechanically depress the market index")
                .isLessThan(baselineIdx);
    }

    private static double idx(SimulationEngine engine) {
        Object idx = engine.state().module("finance").state().get("indexLevel");
        return idx instanceof Number n ? n.doubleValue() : Double.NaN;
    }

    /** Event identity: comparison ignores the random UUID but keeps all sim-relevant fields. */
    private static List<String> count(List<SimEvent> events) {
        return events.stream()
                .map(e -> "%d|%s|%s|%s|%s|%.4f".formatted(e.tick(), e.ts(), e.domain(),
                        e.type(), e.region(), e.severity()))
                .toList();
    }
}