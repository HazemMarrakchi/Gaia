package com.gaia.simulator.engine;

import com.gaia.simulator.domain.event.SimEvent;

import java.time.Instant;
import java.util.List;

/**
 * Orchestrates the discrete-event loop:
 *
 * <pre>
 *   tick 0 → ENERGY.tick → CITIES.tick → TRANSPORT.tick → FINANCE.tick
 *          → collect events → drain to ingestion
 * </pre>
 *
 * Deterministic: constructed with a {@code seed}; each tick derives a fresh
 * {@link SplittableRandom} so replays and what-if clones reproduce exactly.
 */
public final class SimulationEngine {

    private final SimulationState state;
    private final long stepMillis;
    private final long seed;
    private TickContext ctx;

    public SimulationEngine(SimulationState state, long seed, long stepMillis, Instant start) {
        this.state = state;
        this.seed = seed;
        this.stepMillis = stepMillis;
        this.ctx = new TickContext(0, start, new SplittableRandom(seed));
    }

    /** Runs exactly one tick and returns the events produced by all modules. */
    public List<SimEvent> step() {
        for (String name : List.of("energy", "cities", "transport", "finance")) {
            SimModule m = state.module(name);
            m.tick(ctx);
            state.collect(m.drainEvents());
        }
        List<SimEvent> events = state.drainAllEvents();
        ctx = TickContext.next(ctx, stepMillis, seed);
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
        return ctx.tick();
    }

    public SimulationState state() {
        return state;
    }
}