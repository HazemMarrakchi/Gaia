package com.gaia.simulator;

import com.gaia.simulator.domain.WorldFactory;
import com.gaia.simulator.domain.event.SimEvent;
import com.gaia.simulator.engine.SimulationEngine;

import java.time.Instant;
import java.util.List;

/**
 * Deterministic simulation driver. Runs N ticks on the default world and
 * prints a compact event summary — the exact same event stream the
 * ingestion-service would publish to Kafka in production.
 *
 * <pre>
 *   java -jar simulator-core.jar [ticks] [seed]
 * </pre>
 */
public final class SimulatorCli {

    private SimulatorCli() {
    }

    public static void main(String[] args) {
        long ticks = args.length > 0 ? Long.parseLong(args[0]) : 10_000;
        long seed = args.length > 1 ? Long.parseLong(args[1]) : 42L;

        var state = WorldFactory.defaultWorld(3, 4, 3, 4, 3);
        var engine = new SimulationEngine(state, seed, 50, Instant.parse("2026-09-15T00:00:00Z"));

        System.out.printf("GAIA simulator: ticks=%d seed=%d%n", ticks, seed);
        long start = System.currentTimeMillis();
        List<SimEvent> all = engine.run(ticks);
        long ms = System.currentTimeMillis() - start;

        long energy = all.stream().filter(e -> e.domain().label().equals("energy")).count();
        long cities = all.stream().filter(e -> e.domain().label().equals("cities")).count();
        long transport = all.stream().filter(e -> e.domain().label().equals("transport")).count();
        long finance = all.stream().filter(e -> e.domain().label().equals("finance")).count();

        System.out.printf("events: total=%d energy=%d cities=%d transport=%d finance=%d (%d ms)%n",
                all.size(), energy, cities, transport, finance, ms);
        all.stream().limit(10).forEach(System.out::println);
    }
}