package com.gaia.simulator;

import com.gaia.simulator.domain.WorldFactory;
import com.gaia.simulator.domain.event.SimEvent;
import com.gaia.simulator.engine.SimulationEngine;
import com.gaia.simulator.engine.SimulationState;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class DomainModuleTest {

    @Test
    void heatwavePerturbationRaisesEnergyStress() {
        SimulationState baseline = WorldFactory.defaultWorld(3, 4, 3, 4, 3);

        SimulationEngine base = new SimulationEngine(baseline, 7L, 50L,
                Instant.parse("2026-09-15T00:00:00Z"));
        List<SimEvent> baseEvents = base.run(200);

        SimulationEngine perturbed = new SimulationEngine(
                WorldFactory.defaultWorld(3, 4, 3, 4, 3), 7L, 50L,
                Instant.parse("2026-09-15T00:00:00Z"));
        perturbed.state().module("energy")
                .applyPerturbation("HEATWAVE_EU_JULY", java.util.Map.of());
        List<SimEvent> hotEvents = perturbed.run(200);

        double baseStress = maxGridStress(baseEvents);
        double hotStress = maxGridStress(hotEvents);
        assertThat(hotStress).isGreaterThan(baseStress);
    }

    @Test
    void snapshotExposesAllFourDomains() {
        var snapshot = WorldFactory.defaultWorld(3, 4, 3, 4, 3).snapshot();
        assertThat(snapshot.keySet())
                .containsExactlyInAnyOrder("energy", "cities", "transport", "finance");
    }

    @Test
    void plantOutagePerturbationIncreasesShortages() {
        SimulationEngine e = new SimulationEngine(WorldFactory.defaultWorld(3, 4, 3, 4, 3),
                7L, 50L, Instant.parse("2026-09-15T00:00:00Z"));
        e.run(50);

        double before = maxGridStress(e.run(100));
        e.state().module("energy").applyPerturbation("CLOSE_PLANT",
                java.util.Map.of("plant", "thermal-A"));
        double after = maxGridStress(e.run(100));

        assertThat(after).isGreaterThanOrEqualTo(before);
    }

    private static double maxGridStress(List<SimEvent> events) {
        return events.stream()
                .filter(e -> e.type().equals("GRID_STRESS"))
                .mapToDouble(SimEvent::severity)
                .max().orElse(0.0);
    }
}