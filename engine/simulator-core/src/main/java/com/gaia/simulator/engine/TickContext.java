package com.gaia.simulator.engine;

import java.time.Instant;
import java.util.SplittableRandom;

/**
 * Immutable per-tick context: timestamp, tick index, the deterministic
 * RNG derived from the run seed, and the cross-domain shock seen by the
 * previous tick (EMA of max severity). Same seed + same config ⇒ identical ticks.
 */
public record TickContext(long tick, Instant timestamp, SplittableRandom rng, double externalShock) {

    public static TickContext of(long tick, Instant timestamp, SplittableRandom rng, double externalShock) {
        return new TickContext(tick, timestamp, rng, externalShock);
    }

    public static TickContext initial(long tick, Instant timestamp, SplittableRandom rng) {
        return new TickContext(tick, timestamp, rng, 0.0);
    }
}