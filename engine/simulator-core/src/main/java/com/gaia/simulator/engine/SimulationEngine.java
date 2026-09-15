package com.gaia.simulator.engine;

import com.gaia.simulator.domain.event.SimEvent;

import java.time.Instant;
import java.util.List;
import java.util.SplittableRandom;

/**
 * Orchestrates the discrete-event loop:
 *
 * <pre>
 *   tick 0 → ENERGY.tick → CITIES.tick → TRANSPORT.tick → FINANCE.tick
 *          → collect events → drain to ingestion
 * </pre>
 *
 * Deterministic: constructed with a {@code seed}; each tick derives its RNG by
 * {@link SplittableRandom#split()} from a master so replays and what-if clones
 * reproduce exactly, while successive ticks never reuse the same sequence.
 */
public final class SimulationEngine {

    private final SimulationState state;
    private final long stepMillis;
    private final SplittableRandom master;
    private long tick;
    private Instant current;
    private TickContext ctx;
    private double externalShock = 0.0;

    public SimulationEngine(SimulationState state, long seed, long stepMillis, Instant start) {
        this.state = state;
        this.stepMillis = stepMillis;
        this.master = new SplittableRandom(seed);
        this.tick = 0;
        this.current = start;
    }

    /** Runs exactly one tick and returns the events produced by all modules. */
    public List<SimEvent> step() {
        ctx = TickContext.of(tick, current, master.split(), externalShock);
        for (String name : List.of("energy", "cities", "transport", "finance")) {
            SimModule m = state.module(name);
            m.tick(ctx);
            state.collect(m.drainEvents());
        }
        List<SimEvent> events = state.drainAllEvents();
        double maxSeverity = events.stream()
                .filter(e -> !e.domain().name().equals("FINANCE"))
                .mapToDouble(SimEvent::severity)
                .max().orElse(0.0);
        externalShock += (maxSeverity - externalShock) * 0.3; // EMA: cross-domain propagation
        tick++;
        current = current.plusMillis(stepMillis);
        return events;
    }

    /** Runs {@code n} ticks, returning the concatenated event stream. */
    public List<SimEvent> run(long n) {
        var all = new java.util.ArrayList<SimEvent>();
        for (long i = 0; i < n; i++) {
            all.addAll(step());
        }
        return all;
    }

    public long tickIndex() {
        return tick;
    }

    public SimulationState state() {
        return state;
    }

    /** Current EMA of cross-domain crisis severity (what finance reacts to). */
    public double externalShock() {
        return externalShock;
    }
}