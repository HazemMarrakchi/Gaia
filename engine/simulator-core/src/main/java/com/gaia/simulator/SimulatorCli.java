package com.gaia.simulator;

import com.gaia.simulator.domain.WorldFactory;
import com.gaia.simulator.domain.event.SimEvent;
import com.gaia.simulator.engine.SimulationEngine;

import java.time.Instant;
import java.util.List;

/**
 * Deterministic simulation driver. Runs N ticks on the configured world and
 * prints a compact event summary — the exact same event stream the
 * ingestion-service would publish to Kafka in production.
 *
 * <pre>
 *   java -jar simulator-core.jar [ticks] [seed] [entities]
 * </pre>
 */
public final class SimulatorCli {

    private SimulatorCli() {
    }

    public static void main(String[] args) {
        long ticks = args.length > 0 ? Long.parseLong(args[0]) : 10_000;
        long seed = args.length > 1 ? Long.parseLong(args[1]) : 42L;
        long entities = args.length > 2 ? Long.parseLong(args[2])
                : Long.parseLong(System.getenv().getOrDefault("SIM_MAX_ENTITIES", "1000000"));

        long t0 = System.currentTimeMillis();
        var state = WorldFactory.entitiesWorld(entities);
        long buildMs = System.currentTimeMillis() - t0;
        var engine = new SimulationEngine(state, seed, 50, Instant.parse("2026-09-15T00:00:00Z"));

        System.out.printf("GAIA simulator: ticks=%d seed=%d entities=%d%n", ticks, seed, entities);
        long start = System.currentTimeMillis();
        List<SimEvent> all = engine.run(ticks);
        long ms = System.currentTimeMillis() - start;

        long energy = all.stream().filter(e -> e.domain().label().equals("energy")).count();
        long cities = all.stream().filter(e -> e.domain().label().equals("cities")).count();
        long transport = all.stream().filter(e -> e.domain().label().equals("transport")).count();
        long finance = all.stream().filter(e -> e.domain().label().equals("finance")).count();

        System.out.printf("events: total=%d energy=%d cities=%d transport=%d finance=%d (build=%d ms, run=%d ms, %.1f ticks/s)%n",
                all.size(), energy, cities, transport, finance, buildMs, ms,
                ms == 0 ? 0 : ticks * 1000.0 / ms);
    }
}